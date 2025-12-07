use crate::domains::agents::{AgentLaunchSpec, naming::sanitize_name};
use crate::shared::terminal_id::{terminal_id_for_session_bottom, terminal_id_for_session_top};
use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use log::{info, warn};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use which::which;

#[cfg(test)]
const GIT_STATS_STALE_THRESHOLD_SECS: i64 = 60;

#[cfg(test)]
fn get_or_compute_git_stats(
    session_id: &str,
    worktree_path: &Path,
    parent_branch: &str,
    cached_stats: Option<&GitStats>,
    save_fn: impl FnOnce(&GitStats) -> Result<()>,
) -> Option<GitStats> {
    match cached_stats {
        Some(existing) => {
            let is_stale = Utc::now().timestamp() - existing.calculated_at.timestamp()
                > GIT_STATS_STALE_THRESHOLD_SECS;
            if is_stale {
                let mut updated = git::calculate_git_stats_fast(worktree_path, parent_branch).ok();
                if let Some(ref mut s) = updated {
                    s.session_id = session_id.to_string();
                    let _ = save_fn(s);
                }
                updated.or_else(|| Some(existing.clone()))
            } else {
                Some(existing.clone())
            }
        }
        None => {
            let mut computed = git::calculate_git_stats_fast(worktree_path, parent_branch).ok();
            if let Some(ref mut s) = computed {
                s.session_id = session_id.to_string();
                let _ = save_fn(s);
            }
            computed
        }
    }
}

fn normalize_binary_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let unquoted = if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    };

    if let (Some(path_after_tilde), Ok(home)) = (unquoted.strip_prefix("~/"), std::env::var("HOME"))
    {
        return Some(format!("{home}/{path_after_tilde}"));
    }

    Some(unquoted)
}

fn binary_invocation_exists(raw: &str) -> bool {
    let Some(spec) = normalize_binary_path(raw) else {
        return false;
    };

    if spec.contains('/') {
        Path::new(&spec).exists()
    } else {
        which(&spec).is_ok()
    }
}

fn agent_binary_available(agent: &str, binary_paths: &HashMap<String, String>) -> bool {
    if agent == "terminal" || binary_paths.is_empty() {
        return true;
    }

    binary_paths
        .get(agent)
        .map(|path| binary_invocation_exists(path))
        .unwrap_or(false)
}

fn resolve_launch_agent(
    preferred: &str,
    binary_paths: &HashMap<String, String>,
) -> Result<String> {
    let preferred_normalized = preferred.trim();
    let desired = if preferred_normalized.is_empty() {
        "claude".to_string()
    } else {
        preferred_normalized.to_lowercase()
    };

    if agent_binary_available(&desired, binary_paths) {
        return Ok(desired);
    }

    let configured_path = binary_paths
        .get(&desired)
        .map(|p| format!(" (configured path: {p})"))
        .unwrap_or_default();

    Err(anyhow!(
        "Agent '{desired}' is not available{configured_path}. Please install it or select a different agent in Settings."
    ))
}

pub struct SessionCreationParams<'a> {
    pub name: &'a str,
    pub prompt: Option<&'a str>,
    pub base_branch: Option<&'a str>,
    pub custom_branch: Option<&'a str>,
    pub use_existing_branch: bool,
    /// CAUTION: Only enable for branches where the remote is the source of truth (e.g., PR
    /// branches from GitHub). When true, the local branch will be fast-forwarded to match
    /// origin if it's behind. Local commits that are ahead of origin are preserved (no data
    /// loss), but the sync is skipped with a warning. Never enable this for local development
    /// branches where users may have unpushed commits.
    pub sync_with_origin: bool,
    pub was_auto_generated: bool,
    pub version_group_id: Option<&'a str>,
    pub version_number: Option<i32>,
    pub agent_type: Option<&'a str>,
    pub skip_permissions: Option<bool>,
}

#[cfg(test)]
use crate::domains::sessions::entity::GitStats;
use crate::{
    domains::git::service as git,
    domains::sessions::cache::SessionCacheManager,
    domains::sessions::db_sessions::SessionMethods,
    domains::sessions::entity::ArchivedSpec,
    domains::sessions::entity::{
        DiffStats, EnrichedSession, FilterMode, Session, SessionInfo, SessionState, SessionStatus,
        SessionStatusType, SessionType, SortMode, Spec,
    },
    domains::sessions::repository::SessionDbManager,
    domains::sessions::utils::SessionUtils,
    shared::format_branch_name,
    infrastructure::database::db_project_config::{DEFAULT_BRANCH_PREFIX, ProjectConfigMethods},
    infrastructure::database::{Database, db_archived_specs::ArchivedSpecMethods as _},
};
use uuid::Uuid;

#[cfg(test)]
mod service_unified_tests {
    use super::*;
    use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
    use crate::infrastructure::database::Database;
    use crate::utils::env_adapter::EnvAdapter;
    use chrono::Utc;
    use serial_test::serial;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn create_temp_executable(dir: &TempDir, name: &str) -> String {
        let path = dir.path().join(name);
        std::fs::write(&path, "#!/bin/sh\necho test\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms).unwrap();
        }
        path.to_string_lossy().to_string()
    }

    #[test]
    fn resolve_launch_agent_respects_custom_path() {
        let temp_dir = TempDir::new().unwrap();
        let custom_path = create_temp_executable(&temp_dir, "claude");
        let mut binaries = HashMap::new();
        binaries.insert("claude".to_string(), custom_path);

        let agent = super::resolve_launch_agent("claude", &binaries).unwrap();
        assert_eq!(agent, "claude");
    }

    #[test]
    fn resolve_launch_agent_returns_error_when_agent_unavailable() {
        let temp_dir = TempDir::new().unwrap();
        let codex_path = create_temp_executable(&temp_dir, "codex");
        let mut binaries = HashMap::new();
        binaries.insert("claude".to_string(), "/nonexistent/claude".to_string());
        binaries.insert("codex".to_string(), codex_path);

        let result = super::resolve_launch_agent("claude", &binaries);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("claude"));
        assert!(err_msg.contains("not available"));
    }
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
            original_parent_branch: Some("main".to_string()),
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
            amp_thread_id: None,
        }
    }

    #[test]
    #[serial_test::serial]
    fn test_resume_gating_after_spec_then_first_start_is_fresh() {
        let (manager, temp_dir) = create_test_session_manager();
        let home_dir = tempfile::tempdir().unwrap();
        let prev_home = std::env::var("HOME").ok();
        let override_key = "SCHALTWERK_CLAUDE_HOME_OVERRIDE";
        let prev_override = std::env::var(override_key).ok();
        EnvAdapter::set_var("HOME", &home_dir.path().to_string_lossy());
        EnvAdapter::set_var(override_key, &home_dir.path().to_string_lossy());

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
        let session = manager
            .start_spec_session(spec_name, None, None, None)
            .unwrap();

        // Simulate Claude session files existing for this worktree so resume would normally happen
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
        let resume_file = projects.join("resume-session-id.jsonl");
        let resume_content = format!(
            "{{\"sessionId\":\"resume-session-id\",\"cwd\":\"{}\"}}",
            session.worktree_path.to_string_lossy()
        );
        std::fs::write(resume_file, resume_content).unwrap();

        // First start should be FRESH (no --continue / no -r)
        let cmd1 = manager
            .start_claude_in_session_with_restart_and_binary(
                &session.name,
                false,
                &HashMap::new(),
                None,
            )
            .unwrap();
        let shell1 = &cmd1.shell_command;
        assert!(shell1.contains(" claude"));
        assert!(!shell1.contains("--continue"));
        assert!(!shell1.contains(" -r "));

        // Second start should allow resume now (resume_allowed flipped true)
        let cmd2 = manager
            .start_claude_in_session_with_restart_and_binary(
                &session.name,
                false,
                &HashMap::new(),
                None,
            )
            .unwrap();
        let shell2 = &cmd2.shell_command;
        assert!(
            shell2.contains(" -r resume-session-id"),
            "Expected resume via explicit -r <session> on second start"
        );

        if let Some(h) = prev_home {
            EnvAdapter::set_var("HOME", &h);
        } else {
            EnvAdapter::remove_var("HOME");
        }
        if let Some(v) = prev_override {
            EnvAdapter::set_var(override_key, &v);
        } else {
            EnvAdapter::remove_var(override_key);
        }
    }

    #[test]
    fn test_unified_registry_produces_same_commands_as_old_match() {
        let (manager, temp_dir) = create_test_session_manager();
        let _registry = crate::domains::agents::unified::AgentRegistry::new();

        // Test each supported agent type
        for (i, agent_type) in ["claude", "codex", "gemini", "opencode", "kilocode"]
            .iter()
            .enumerate()
        {
            let session = create_test_session(&temp_dir, agent_type, &i.to_string());

            // Create session in database
            manager.db_manager.create_session(&session).unwrap();

            // Get the unified command using the new registry approach
            let binary_paths = HashMap::new();
            let result = manager.start_claude_in_session_with_restart_and_binary(
                &session.name,
                false,
                &binary_paths,
                None,
            );

            // Should succeed for all supported agents
            assert!(result.is_ok(), "Agent {} should be supported", agent_type);

            let command = result.unwrap();
            let shell_command = &command.shell_command;

            // Verify command contains expected elements
            assert!(shell_command.contains(&format!("cd {}", session.worktree_path.display())));
            // Verify the command contains the agent type
            assert!(
                shell_command.contains(agent_type),
                "Command for {} should contain agent name",
                agent_type
            );
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
            None,
        );

        assert!(result.is_ok());
        let command = result.unwrap();
        assert!(
            command
                .shell_command
                .contains("--sandbox danger-full-access")
        );

        // Test with skip_permissions = false
        session.id = Uuid::new_v4().to_string();
        session.name = "test-session-safe".to_string();
        session.original_skip_permissions = Some(false);
        manager.db_manager.create_session(&session).unwrap();

        let result = manager.start_claude_in_session_with_restart_and_binary(
            &session.name,
            false,
            &binary_paths,
            None,
        );

        assert!(result.is_ok());
        let command = result.unwrap();
        assert!(command.shell_command.contains("--sandbox workspace-write"));
    }

    #[test]
    fn amp_session_uses_stored_thread_id_for_resume() {
        let (manager, temp_dir) = create_test_session_manager();
        let mut session = create_test_session(&temp_dir, "amp", "resume");
        session.amp_thread_id = Some("thread-42".to_string());
        session.original_skip_permissions = Some(false);
        manager.db_manager.create_session(&session).unwrap();

        let spec = manager
            .start_claude_in_session_with_restart_and_binary(
                &session.name,
                false,
                &HashMap::new(),
                None,
            )
            .expect("Amp launch spec should build");

        assert!(
            spec.shell_command.contains("threads continue thread-42"),
            "Amp launch command should resume stored thread id"
        );
    }

    fn sanitize_path_for_opencode(path: &Path) -> String {
        let path_str = path.to_string_lossy();
        let without_leading_slash = path_str.trim_start_matches('/');
        let mut result = String::new();
        for (i, component) in without_leading_slash.split('/').enumerate() {
            if component.is_empty() {
                continue;
            }
            if i > 0 {
                if component.starts_with('.') {
                    result.push_str("--");
                } else {
                    result.push('-');
                }
            }
            if let Some(stripped) = component.strip_prefix('.') {
                result.push_str(&stripped.replace('.', "-"));
            } else {
                result.push_str(&component.replace('.', "-"));
            }
        }
        result
    }

    fn setup_opencode_session_history(
        root: &Path,
        worktree_path: &Path,
        session_id: &str,
        message_file_count: usize,
    ) {
        let sanitized = sanitize_path_for_opencode(worktree_path);
        let base = root
            .join(".local")
            .join("share")
            .join("opencode")
            .join("project")
            .join(sanitized);
        let info_dir = base.join("storage").join("session").join("info");
        std::fs::create_dir_all(&info_dir).unwrap();
        std::fs::write(info_dir.join(format!("{session_id}.json")), "{}{}").unwrap();

        let message_dir = base
            .join("storage")
            .join("session")
            .join("message")
            .join(session_id);
        std::fs::create_dir_all(&message_dir).unwrap();
        for idx in 0..message_file_count {
            std::fs::write(message_dir.join(format!("{idx}.json")), "{}").unwrap();
        }
    }

    #[test]
    #[serial_test::serial]
    fn test_opencode_resumes_when_history_exists() {
        let (manager, temp_dir) = create_test_session_manager();
        let session = create_test_session(&temp_dir, "opencode", "resume");
        manager.db_manager.create_session(&session).unwrap();

        let home_dir = tempfile::TempDir::new().unwrap();
        let prev_home = std::env::var("HOME").ok();
        EnvAdapter::set_var("HOME", &home_dir.path().to_string_lossy());

        std::fs::create_dir_all(temp_dir.path().join("repo").join(".git")).unwrap();

        setup_opencode_session_history(home_dir.path(), &session.worktree_path, "oc-session", 3);

        let cmd = manager
            .start_claude_in_session_with_restart_and_binary(
                &session.name,
                false,
                &HashMap::new(),
                None,
            )
            .expect("expected OpenCode command");
        let shell_command = &cmd.shell_command;

        assert!(
            shell_command.contains("opencode"),
            "expected opencode binary to be invoked: {}",
            shell_command
        );
        assert!(
            shell_command.contains("--session \"oc-session\""),
            "expected resume via --session when history exists: {}",
            shell_command
        );
        assert!(
            !shell_command.contains("--prompt"),
            "should not include prompt when resuming: {}",
            shell_command
        );

        if let Some(prev) = prev_home {
            EnvAdapter::set_var("HOME", &prev);
        } else {
            EnvAdapter::remove_var("HOME");
        }
    }

    #[test]
    #[serial_test::serial]
    fn test_opencode_respects_resume_gate_then_resumes() {
        let (manager, temp_dir) = create_test_session_manager();
        let mut session = create_test_session(&temp_dir, "opencode", "gate");
        session.resume_allowed = false;
        manager.db_manager.create_session(&session).unwrap();

        let home_dir = tempfile::TempDir::new().unwrap();
        let prev_home = std::env::var("HOME").ok();
        EnvAdapter::set_var("HOME", &home_dir.path().to_string_lossy());

        std::fs::create_dir_all(temp_dir.path().join("repo").join(".git")).unwrap();

        setup_opencode_session_history(home_dir.path(), &session.worktree_path, "oc-gate", 4);

        let cmd_first = manager
            .start_claude_in_session_with_restart_and_binary(
                &session.name,
                false,
                &HashMap::new(),
                None,
            )
            .expect("expected OpenCode command");
        let first_shell = &cmd_first.shell_command;

        assert!(
            !first_shell.contains("--session"),
            "resume should be gated off on first start"
        );
        assert!(
            first_shell.contains("--prompt \"test prompt\""),
            "first start should use initial prompt when resume is gated"
        );

        let refreshed = manager
            .db_manager
            .get_session_by_name(&session.name)
            .expect("session should still exist");
        assert!(
            refreshed.resume_allowed,
            "resume_allowed should flip true after fresh start"
        );

        let cmd_second = manager
            .start_claude_in_session_with_restart_and_binary(
                &session.name,
                false,
                &HashMap::new(),
                None,
            )
            .expect("expected OpenCode command");
        let second_shell = &cmd_second.shell_command;

        assert!(
            second_shell.contains("--session \"oc-gate\""),
            "second start should resume once gate is lifted"
        );
        assert!(
            !second_shell.contains("--prompt"),
            "resume path should not include prompt"
        );

        if let Some(prev) = prev_home {
            EnvAdapter::set_var("HOME", &prev);
        } else {
            EnvAdapter::remove_var("HOME");
        }
    }

    #[test]
    fn list_enriched_sessions_retains_missing_worktree_entries() {
        let (manager, temp_dir) = create_test_session_manager();
        let session = create_test_session(&temp_dir, "claude", "missing");
        manager
            .db_manager
            .create_session(&session)
            .expect("session should be created");

        // Simulate transient filesystem blip where the worktree path is temporarily missing
        std::fs::remove_dir_all(&session.worktree_path).unwrap();

        let enriched = manager
            .list_enriched_sessions()
            .expect("listing enriched sessions should succeed");

        assert_eq!(
            enriched.len(),
            1,
            "Session should remain visible even if the worktree is temporarily missing"
        );
        assert_eq!(enriched[0].info.session_id, session.name);
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

        let running = manager
            .start_spec_session_with_config(spec_name, None, None, None, Some("codex"), Some(true))
            .unwrap();

        // Build the start command (unified start handles correct agent based on original settings)
        let cmd = manager
            .start_claude_in_session(&running.name)
            .expect("expected start command");
        let shell_command = &cmd.shell_command;

        // Verify Codex is used with the correct sandbox and prompt, and no resume flags on first start
        assert!(
            shell_command.contains(" codex ") || shell_command.ends_with(" codex"),
            "expected Codex binary in command: {}",
            shell_command
        );
        assert!(
            shell_command.contains("--sandbox danger-full-access"),
            "expected danger sandbox when skip_permissions=true: {}",
            shell_command
        );
        assert!(
            shell_command.contains(spec_content),
            "expected spec content to be used as initial prompt: {}",
            shell_command
        );
        assert!(
            !(shell_command.contains(" codex --sandbox ") && shell_command.contains(" resume")),
            "should not resume on first start after spec: {}",
            shell_command
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
        EnvAdapter::set_var("HOME", &home_dir.path().to_string_lossy());

        // Second start should allow resume now (gate flips after fresh start and session file exists)
        let cmd2 = manager.start_claude_in_session(&running.name).unwrap();
        let resumed = cmd2.shell_command.contains(" codex --sandbox ")
            && cmd2.shell_command.contains(" resume");
        assert!(
            resumed,
            "expected resume-capable command on second start: {}",
            cmd2.shell_command
        );

        // Restore HOME
        if let Some(h) = prev_home {
            EnvAdapter::set_var("HOME", &h);
        } else {
            EnvAdapter::remove_var("HOME");
        }
    }

    #[test]
    #[serial_test::serial]
    fn start_spec_session_with_config_sets_session_original_settings_without_touching_globals() {
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

        // Seed globals to known defaults and ensure they remain unchanged
        manager.set_global_agent_type("claude").unwrap();
        manager.set_global_skip_permissions(false).unwrap();

        let spec_name = "codex_spec_isolated_globals";
        let spec_content = "Implement feature Z with Codex";
        manager
            .create_spec_session(spec_name, spec_content)
            .unwrap();

        let running = manager
            .start_spec_session_with_config(spec_name, None, None, None, Some("codex"), Some(true))
            .unwrap();

        let stored = manager
            .db_manager
            .get_session_by_name(&running.name)
            .expect("session should be persisted");
        assert_eq!(stored.original_agent_type.as_deref(), Some("codex"));
        assert_eq!(stored.original_skip_permissions, Some(true));

        assert_eq!(manager.db_manager.get_agent_type().unwrap(), "claude");
        assert!(!manager.db_manager.get_skip_permissions().unwrap());
    }

    #[test]
    #[serial_test::serial]
    fn test_droid_receives_initial_prompt_on_fresh_start() {
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

        let spec_name = "droid_spec";
        let spec_content = "Review the codebase and suggest improvements";
        manager
            .create_spec_session(spec_name, spec_content)
            .unwrap();

        let running = manager
            .start_spec_session_with_config(spec_name, None, None, None, Some("droid"), None)
            .unwrap();

        let cmd = manager
            .start_claude_in_session(&running.name)
            .expect("expected start command");
        let shell_command = &cmd.shell_command;

        assert!(
            shell_command.contains(" droid ") || shell_command.ends_with(" droid"),
            "expected droid binary in command: {}",
            shell_command
        );
        assert!(
            shell_command.contains(spec_content),
            "expected spec content to be passed as initial prompt on fresh start: {}",
            shell_command
        );
        assert!(
            !shell_command.contains(" -r "),
            "should not have resume flag on fresh start: {}",
            shell_command
        );
    }

    #[test]
    #[serial_test::serial]
    fn test_droid_resumes_without_prompt_when_session_exists() {
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

        let spec_name = "droid_resume_spec";
        let spec_content = "Continue the work";
        manager
            .create_spec_session(spec_name, spec_content)
            .unwrap();

        let running = manager
            .start_spec_session_with_config(spec_name, None, None, None, Some("droid"), None)
            .unwrap();

        let home_dir = tempfile::TempDir::new().unwrap();
        let sessions_dir = home_dir.path().join(".factory/sessions");
        std::fs::create_dir_all(&sessions_dir).unwrap();

        let session_file = sessions_dir.join("droid-session-123.jsonl");
        use std::io::Write;
        let mut f = std::fs::File::create(&session_file).unwrap();
        writeln!(
            f,
            "{{\"id\":\"droid-session-123\",\"timestamp\":\"2025-11-02T00:00:00.000Z\"}}"
        )
        .unwrap();
        writeln!(
            f,
            "{{\"message\":{{\"content\":[{{\"text\":\"% pwd\\n{}\\n\"}}]}}}}",
            running.worktree_path.display()
        )
        .unwrap();

        let prev_home = std::env::var("HOME").ok();
        EnvAdapter::set_var("HOME", &home_dir.path().to_string_lossy());

        manager
            .db_manager
            .set_session_resume_allowed(&running.id, true)
            .unwrap();

        let cmd = manager
            .start_claude_in_session(&running.name)
            .expect("expected start command");
        let shell_command = &cmd.shell_command;

        assert!(
            shell_command.contains(" droid ") || shell_command.ends_with(" droid"),
            "expected droid binary in command: {}",
            shell_command
        );
        assert!(
            shell_command.contains(" -r droid-session-123"),
            "expected resume flag with session ID when session exists: {}",
            shell_command
        );
        assert!(
            !shell_command.contains(spec_content),
            "should not pass prompt when resuming: {}",
            shell_command
        );

        if let Some(h) = prev_home {
            EnvAdapter::set_var("HOME", &h);
        } else {
            EnvAdapter::remove_var("HOME");
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

        let running = manager
            .start_spec_session_with_config(
                spec_name,
                None,
                Some(group_id),
                Some(1),
                Some("codex"),
                Some(false),
            )
            .unwrap();
        assert_eq!(running.version_group_id.as_deref(), Some(group_id));
        assert_eq!(running.version_number, Some(1));
    }

    #[test]
    #[serial_test::serial]
    fn start_spec_session_updates_parent_branch_when_override_provided() {
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
        Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(&repo)
            .output()
            .unwrap();
        manager
            .create_spec_session("feature_spec", "Spec content")
            .unwrap();

        Command::new("git")
            .args(["checkout", "-b", "feature/login"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::fs::write(repo.join("feature.txt"), "feature work").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "feature work"])
            .current_dir(&repo)
            .output()
            .unwrap();

        Command::new("git")
            .args(["checkout", "main"])
            .current_dir(&repo)
            .output()
            .unwrap();

        let session = manager
            .start_spec_session("feature_spec", Some("feature/login"), None, None)
            .unwrap();
        assert_eq!(session.parent_branch, "feature/login");

        let session_commit = Command::new("git")
            .args(["rev-parse", &session.branch])
            .current_dir(&repo)
            .output()
            .unwrap();
        let feature_commit = Command::new("git")
            .args(["rev-parse", "feature/login"])
            .current_dir(&repo)
            .output()
            .unwrap();

        assert_eq!(
            String::from_utf8_lossy(&session_commit.stdout).trim(),
            String::from_utf8_lossy(&feature_commit.stdout).trim()
        );
    }

    #[test]
    #[serial_test::serial]
    fn start_spec_session_without_override_uses_default_parent_branch() {
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
        Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["checkout", "-b", "feature/login"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::fs::write(repo.join("feature.txt"), "feature work").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "feature work"])
            .current_dir(&repo)
            .output()
            .unwrap();

        manager
            .create_spec_session("stored_spec", "Spec content")
            .unwrap();

        Command::new("git")
            .args(["checkout", "main"])
            .current_dir(&repo)
            .output()
            .unwrap();

        let session = manager
            .start_spec_session("stored_spec", None, None, None)
            .unwrap();
        assert_eq!(session.parent_branch, "main");

        let session_commit = Command::new("git")
            .args(["rev-parse", &session.branch])
            .current_dir(&repo)
            .output()
            .unwrap();
        let feature_commit = Command::new("git")
            .args(["rev-parse", "main"])
            .current_dir(&repo)
            .output()
            .unwrap();

        assert_eq!(
            String::from_utf8_lossy(&session_commit.stdout).trim(),
            String::from_utf8_lossy(&feature_commit.stdout).trim()
        );
    }

    #[test]
    fn start_spec_session_marks_pending_name_generation_without_display_name() {
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

        manager
            .create_spec_session("spec-pending", "Content for naming")
            .unwrap();

        let session = manager
            .start_spec_session("spec-pending", None, None, None)
            .unwrap();

        assert!(session.pending_name_generation);
        let stored = manager
            .db_manager
            .get_session_by_name(&session.name)
            .unwrap();
        assert!(stored.pending_name_generation);
    }

    #[test]
    fn start_spec_session_applies_existing_display_name() {
        use crate::shared::format_branch_name;
        use crate::infrastructure::database::db_project_config::DEFAULT_BRANCH_PREFIX;
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

        let spec = manager
            .create_spec_session("spec-friendly", "Content")
            .unwrap();

        manager
            .db_manager
            .update_spec_display_name(&spec.id, "friendly-name")
            .unwrap();

        let session = manager
            .start_spec_session("spec-friendly", None, None, None)
            .unwrap();

        assert_eq!(session.display_name.as_deref(), Some("friendly-name"));
        assert!(!session.pending_name_generation);
        assert_eq!(
            session.branch,
            format_branch_name(DEFAULT_BRANCH_PREFIX, "friendly-name")
        );
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
            None,
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
            custom_branch: None,
            use_existing_branch: false,
            sync_with_origin: false,
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
            custom_branch: None,
            use_existing_branch: false,
            sync_with_origin: false,
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
    #[serial]
    fn session_creation_bootstraps_requested_base_branch_in_empty_repo() {
        let (manager, temp_dir) = create_test_session_manager();
        let repo_root = temp_dir.path().join("repo");

        git::init_repository(&repo_root).unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_root)
            .status()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_root)
            .status()
            .unwrap();

        if git::repository_has_commits(&repo_root).unwrap_or(false) {
            std::process::Command::new("git")
                .args(["reset", "--hard", "HEAD~1"])
                .current_dir(&repo_root)
                .output()
                .ok();
            std::process::Command::new("git")
                .args(["clean", "-fd"])
                .current_dir(&repo_root)
                .output()
                .ok();
        }

        let params = SessionCreationParams {
            name: "bootstrap-empty-repo",
            prompt: None,
            base_branch: Some("main"),
            custom_branch: None,
            use_existing_branch: false,
            sync_with_origin: false,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager
            .create_session_with_agent(params)
            .expect("session creation should succeed for empty repo");

        assert_eq!(session.parent_branch, "main");
        assert!(
            git::branch_exists(&repo_root, "main").unwrap(),
            "expected bootstrap process to create 'main' branch"
        );
    }

    #[test]
    fn session_creation_allows_commit_base_reference() {
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
        std::fs::write(repo_root.join("README.md"), "Initial commit body").unwrap();
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

        let rev = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        let commit = String::from_utf8(rev.stdout).unwrap().trim().to_string();

        let params = SessionCreationParams {
            name: "commit-base",
            prompt: None,
            base_branch: Some(&commit),
            custom_branch: None,
            use_existing_branch: false,
            sync_with_origin: false,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager
            .create_session_with_agent(params)
            .expect("session creation should support commit refs");

        assert_eq!(session.parent_branch, commit);
    }

    #[test]
    fn session_creation_persists_selected_agent_settings() {
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

        let params = SessionCreationParams {
            name: "compare-gemini",
            prompt: None,
            base_branch: None,
            custom_branch: None,
            use_existing_branch: false,
            sync_with_origin: false,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: Some("gemini"),
            skip_permissions: Some(true),
        };

        let session = manager
            .create_session_with_agent(params)
            .expect("session creation should succeed");

        assert_eq!(
            session.original_agent_type.as_deref(),
            Some("gemini"),
            "returned session should reflect override agent type"
        );
        assert_eq!(
            session.original_skip_permissions,
            Some(true),
            "returned session should reflect requested skip permissions"
        );

        let persisted = manager
            .db_manager
            .get_session_by_name(&session.name)
            .expect("session should be persisted");

        assert_eq!(
            persisted.original_agent_type.as_deref(),
            Some("gemini"),
            "persisted session should keep override agent type"
        );
        assert_eq!(
            persisted.original_skip_permissions,
            Some(true),
            "persisted session should keep override skip permissions"
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

    #[test]
    fn test_get_or_compute_git_stats_returns_cached_when_fresh() {
        let temp_dir = TempDir::new().unwrap();
        let worktree = temp_dir.path().join("worktree");
        std::fs::create_dir_all(&worktree).unwrap();

        let fresh_stats = GitStats {
            session_id: "test-session".to_string(),
            files_changed: 5,
            lines_added: 100,
            lines_removed: 50,
            has_uncommitted: false,
            calculated_at: Utc::now(),
            last_diff_change_ts: None,
        };

        let mut save_called = false;
        let result = get_or_compute_git_stats(
            "test-session",
            &worktree,
            "main",
            Some(&fresh_stats),
            |_| {
                save_called = true;
                Ok(())
            },
        );

        assert!(result.is_some());
        assert!(!save_called);
        let stats = result.unwrap();
        assert_eq!(stats.files_changed, 5);
    }

    #[test]
    fn test_get_or_compute_git_stats_recomputes_when_stale() {
        let temp_dir = TempDir::new().unwrap();
        let repo = temp_dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();

        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::fs::write(repo.join("test.txt"), "content").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo)
            .output()
            .unwrap();

        let stale_stats = GitStats {
            session_id: "test-session".to_string(),
            files_changed: 999,
            lines_added: 999,
            lines_removed: 999,
            has_uncommitted: false,
            calculated_at: Utc::now() - chrono::Duration::seconds(120),
            last_diff_change_ts: None,
        };

        let mut save_called = false;
        let result =
            get_or_compute_git_stats("test-session", &repo, "main", Some(&stale_stats), |stats| {
                save_called = true;
                assert_eq!(stats.session_id, "test-session");
                Ok(())
            });

        assert!(result.is_some());
        assert!(save_called);
    }

    #[test]
    fn test_get_or_compute_git_stats_returns_cached_when_refresh_fails() {
        let temp_dir = TempDir::new().unwrap();
        let repo = temp_dir.path().join("not-a-repo"); // no git init
        std::fs::create_dir_all(&repo).unwrap();

        let stale_stats = GitStats {
            session_id: "s".into(),
            calculated_at: Utc::now() - chrono::Duration::seconds(120),
            files_changed: 0,
            lines_added: 0,
            lines_removed: 0,
            has_uncommitted: false,
            last_diff_change_ts: None,
        };

        let result = get_or_compute_git_stats("s", &repo, "main", Some(&stale_stats), |_s| Ok(()));

        assert!(
            result.is_some(),
            "should return cached stats on refresh failure"
        );
        let returned = result.unwrap();
        assert_eq!(returned.session_id, "s");
        assert_eq!(
            returned.calculated_at, stale_stats.calculated_at,
            "timestamp remains when refresh fails"
        );
    }

    #[test]
    fn test_get_or_compute_git_stats_computes_when_no_cache() {
        let temp_dir = TempDir::new().unwrap();
        let repo = temp_dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();

        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::fs::write(repo.join("test.txt"), "content").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo)
            .output()
            .unwrap();

        let mut save_called = false;
        let result = get_or_compute_git_stats("test-session", &repo, "main", None, |stats| {
            save_called = true;
            assert_eq!(stats.session_id, "test-session");
            Ok(())
        });

        assert!(result.is_some());
        assert!(save_called);
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
        let candidate = if let Some(branch) = requested {
            let trimmed = branch.trim();
            if trimmed.is_empty() {
                log::warn!("Explicit base branch was empty, falling back to branch detection");
                None
            } else {
                log::info!("Using explicit base branch '{trimmed}' for session setup");
                Some(trimmed.to_string())
            }
        } else {
            None
        };

        if let Some(candidate) = candidate {
            return self.normalize_branch_candidate(&candidate);
        }

        let detected = match crate::domains::git::repository::get_current_branch(&self.repo_path) {
            Ok(current) => {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    log::info!("Detected current HEAD branch '{trimmed}' for session setup");
                    Some(trimmed.to_string())
                } else {
                    log::warn!("Current HEAD branch is empty, falling back to default branch");
                    None
                }
            }
            Err(head_err) => {
                log::warn!(
                    "Failed to detect current HEAD branch for session setup: {head_err}. Falling back to default branch detection."
                );
                None
            }
        };

        if let Some(candidate) = detected {
            return self.normalize_branch_candidate(&candidate);
        }

        let default_branch = crate::domains::git::get_default_branch(&self.repo_path)?;
        let trimmed = default_branch.trim();
        if trimmed.is_empty() {
            return Err(anyhow!(
                "Could not determine base branch: all methods returned empty branch name"
            ));
        }
        log::info!("Using default branch '{trimmed}' as base branch");
        self.normalize_branch_candidate(trimmed)
    }

    fn normalize_branch_candidate(&self, branch: &str) -> Result<String> {
        let repo_display = self.repo_path.display();
        let repo = git2::Repository::open(&self.repo_path).with_context(|| {
            format!("Failed to open repository '{repo_display}' while resolving parent branch")
        })?;
        match git::normalize_branch_to_local(&repo, branch) {
            Ok(local) => Ok(local),
            Err(err) => {
                let repo_empty = repo.is_empty().unwrap_or(false);
                if repo_empty {
                    log::info!(
                        "Repository '{repo_display}' has no commits; deferring normalization for base branch '{branch}' until bootstrap completes"
                    );
                    return Ok(branch.to_string());
                }

                if repo.revparse_single(branch).is_ok() {
                    log::info!(
                        "Base reference '{branch}' resolves via revspec; continuing without local branch normalization"
                    );
                    return Ok(branch.to_string());
                }

                Err(err.context(format!(
                    "Unable to map '{branch}' to a local branch in {repo_display}"
                )))
            }
        }
    }

    fn ensure_repository_initialized(&self, parent_branch: &str) -> Result<()> {
        let existing_branches_list =
            git::list_branches(&self.repo_path).unwrap_or_else(|_| Vec::new());
        let repo_was_empty = !git::repository_has_commits(&self.repo_path).unwrap_or(false)
            || existing_branches_list.is_empty();
        let repo_display = self.repo_path.display();

        let branches_joined = existing_branches_list.join(", ");
        log::info!(
            "Session bootstrap state before worktree creation: repo_was_empty={repo_was_empty}, base_branch='{parent_branch}', repo='{repo_display}', branches=[{branches_joined}]"
        );

        if repo_was_empty {
            let initial_commit_message = git::INITIAL_COMMIT_MESSAGE;
            log::info!(
                "Repository has no commits, creating initial commit: '{initial_commit_message}'"
            );
            git::create_initial_commit(&self.repo_path)?;

            log::info!(
                "Ensuring requested base branch '{parent_branch}' exists after initial commit"
            );
            git::ensure_branch_at_head(&self.repo_path, parent_branch)?;
        }

        Ok(())
    }

    fn apply_display_name_to_session(
        &self,
        session: &mut Session,
        display_name: &str,
    ) -> Result<bool> {
        let sanitized = sanitize_name(display_name);

        if sanitized.is_empty() {
            log::warn!(
                "Display name for session '{}' sanitized to empty; skipping rename",
                session.name
            );
            return Ok(false);
        }

        self.db_manager
            .db
            .update_session_display_name(&session.id, &sanitized)?;
        session.display_name = Some(sanitized.clone());

        let branch_prefix = self
            .db_manager
            .db
            .get_project_branch_prefix(&self.repo_path)
            .unwrap_or_else(|err| {
                log::warn!(
                    "Falling back to default branch prefix while applying display name: {err}"
                );
                DEFAULT_BRANCH_PREFIX.to_string()
            });

        let target_branch = format_branch_name(&branch_prefix, &sanitized);
        if target_branch == session.branch {
            return Ok(true);
        }

        git::rename_branch(&self.repo_path, &session.branch, &target_branch)?;

        if let Err(e) = git::update_worktree_branch(&session.worktree_path, &target_branch) {
            let _ = git::rename_branch(&self.repo_path, &target_branch, &session.branch);
            return Err(e);
        }

        self.db_manager
            .db
            .update_session_branch(&session.id, &target_branch)?;
        session.branch = target_branch;
        Ok(true)
    }

    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        log::trace!(
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
            custom_branch: None,
            use_existing_branch: false,
            sync_with_origin: false,
            was_auto_generated,
            version_group_id,
            version_number,
            agent_type: None,
            skip_permissions: None,
        };
        self.create_session_with_agent(params)
    }

    pub fn create_session_with_agent(&self, params: SessionCreationParams) -> Result<Session> {
        use crate::domains::sessions::lifecycle::bootstrapper::{
            BootstrapConfig, WorktreeBootstrapper,
        };
        use crate::domains::sessions::lifecycle::finalizer::{
            FinalizationConfig, SessionFinalizer,
        };

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

        if params.use_existing_branch {
            let custom_branch = params.custom_branch.ok_or_else(|| {
                anyhow!("use_existing_branch requires custom_branch to be specified")
            })?;

            if let Some(existing_wt) = git::get_worktree_for_branch(&self.repo_path, custom_branch)? {
                return Err(anyhow!(
                    "Branch '{custom_branch}' is already checked out in worktree: {}",
                    existing_wt.display()
                ));
            }

            if params.sync_with_origin
                && let Err(e) = git::safe_sync_branch_with_origin(&self.repo_path, custom_branch)
            {
                log::info!(
                    "Could not sync branch '{custom_branch}' with origin (may be local-only): {e}"
                );
            }

            if !git::branch_exists(&self.repo_path, custom_branch)? {
                return Err(anyhow!(
                    "Branch '{custom_branch}' does not exist. Cannot use existing branch mode with a non-existent branch."
                ));
            }
        }

        let (unique_name, branch, worktree_path) = if let Some(custom_branch) = params.custom_branch
        {
            if !git::is_valid_branch_name(custom_branch) {
                return Err(anyhow!(
                    "Invalid branch name: branch names must be valid git references"
                ));
            }

            let branch_exists = git::branch_exists(&self.repo_path, custom_branch)?;
            let final_branch = if branch_exists {
                let suffix = SessionUtils::generate_random_suffix(2);
                format!("{custom_branch}-{suffix}")
            } else {
                custom_branch.to_string()
            };

            let worktree_path = self
                .repo_path
                .join(".schaltwerk")
                .join("worktrees")
                .join(params.name);

            (params.name.to_string(), final_branch, worktree_path)
        } else {
            self.utils.find_unique_session_paths(params.name)?
        };

        let session_id = SessionUtils::generate_session_id();
        self.utils.cleanup_existing_worktree(&worktree_path)?;

        // When using an existing branch, the parent_branch should be the default branch
        // (e.g., main), not the PR branch itself. Otherwise diffs would compare the branch
        // against itself.
        let parent_branch = if params.use_existing_branch {
            match self.resolve_parent_branch(None) {
                Ok(branch) => branch,
                Err(err) => {
                    self.cache_manager.unreserve_name(&unique_name);
                    return Err(err);
                }
            }
        } else {
            match self.resolve_parent_branch(params.base_branch) {
                Ok(branch) => branch,
                Err(err) => {
                    self.cache_manager.unreserve_name(&unique_name);
                    return Err(err);
                }
            }
        };

        let default_agent_type = self
            .db_manager
            .get_agent_type()
            .unwrap_or_else(|_| "claude".to_string());
        let global_skip_default = self.db_manager.get_skip_permissions().unwrap_or(false);

        let effective_agent_type = params
            .agent_type
            .map(|s| s.to_string())
            .unwrap_or_else(|| default_agent_type.clone());
        let effective_skip_permissions = params.skip_permissions.unwrap_or(global_skip_default);
        let should_copy_claude_locals = effective_agent_type.eq_ignore_ascii_case("claude");

        self.ensure_repository_initialized(&parent_branch)?;

        let bootstrapper = WorktreeBootstrapper::new(&self.repo_path, &self.utils);
        let bootstrap_config = BootstrapConfig {
            session_name: &unique_name,
            branch_name: &branch,
            worktree_path: &worktree_path,
            parent_branch: &parent_branch,
            custom_branch: params.custom_branch,
            use_existing_branch: params.use_existing_branch,
            sync_with_origin: params.sync_with_origin,
            should_copy_claude_locals,
        };

        let bootstrap_result = match bootstrapper.bootstrap_worktree(bootstrap_config) {
            Ok(result) => result,
            Err(e) => {
                self.cache_manager.unreserve_name(&unique_name);
                return Err(e);
            }
        };

        let repo_name = self.utils.get_repo_name()?;
        let now = Utc::now();

        let session = Session {
            id: session_id.clone(),
            name: unique_name.clone(),
            display_name: None,
            version_group_id: params.version_group_id.map(|s| s.to_string()),
            version_number: params.version_number,
            repository_path: self.repo_path.clone(),
            repository_name: repo_name,
            branch: bootstrap_result.branch.clone(),
            parent_branch: bootstrap_result.parent_branch.clone(),
            original_parent_branch: Some(bootstrap_result.parent_branch.clone()),
            worktree_path: bootstrap_result.worktree_path.clone(),
            status: SessionStatus::Active,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: params.prompt.map(String::from),
            ready_to_merge: false,
            original_agent_type: Some(effective_agent_type.clone()),
            original_skip_permissions: Some(effective_skip_permissions),
            pending_name_generation: params.was_auto_generated,
            was_auto_generated: params.was_auto_generated,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
            amp_thread_id: None,
        };

        let finalizer = SessionFinalizer::new(&self.db_manager, &self.cache_manager);
        let finalization_config = FinalizationConfig {
            session: session.clone(),
            compute_git_stats: true,
            update_activity: true,
        };

        let finalization_result = match finalizer.finalize_creation(finalization_config) {
            Ok(result) => result,
            Err(e) => {
                let _ = git::remove_worktree(&self.repo_path, &worktree_path);
                let _ = git::delete_branch(&self.repo_path, &branch);
                self.cache_manager.unreserve_name(&unique_name);
                return Err(e);
            }
        };

        if let Err(e) = self.db_manager.set_session_original_settings(
            &session.id,
            &effective_agent_type,
            effective_skip_permissions,
        ) {
            log::warn!("Failed to set original agent settings: {e}");
        }

        self.cache_manager.unreserve_name(&unique_name);
        log::info!("Successfully created session '{unique_name}'");
        Ok(finalization_result.session)
    }

    pub fn cancel_session(&self, name: &str) -> Result<()> {
        use crate::domains::sessions::lifecycle::cancellation::{
            CancellationConfig, CancellationCoordinator,
        };

        let session = match self.db_manager.get_session_by_name(name) {
            Ok(s) => s,
            Err(e) => {
                // If this is a spec stored in specs table, archive it directly
                if self.db_manager.get_spec_by_name(name).is_ok() {
                    log::info!("Cancel {name}: Archiving spec (spec store)");
                    self.archive_spec_session(name)?;
                    return Ok(());
                }
                return Err(e);
            }
        };
        log::debug!("Cancel {name}: Retrieved session");

        if session.session_state == SessionState::Spec {
            log::info!("Cancel {name}: Archiving spec session instead of cancelling");
            self.archive_spec_session(name)?;
            return Ok(());
        }

        let coordinator = CancellationCoordinator::new(&self.repo_path, &self.db_manager);
        let config = CancellationConfig {
            force: false,
            skip_process_cleanup: false,
            skip_branch_deletion: false,
        };

        coordinator.cancel_session(&session, config)?;
        Ok(())
    }

    /// Fast asynchronous session cancellation with parallel operations
    pub async fn fast_cancel_session(&self, name: &str) -> Result<()> {
        use crate::domains::sessions::lifecycle::cancellation::{
            CancellationConfig, CancellationCoordinator,
        };

        let session = self.db_manager.get_session_by_name(name)?;

        let coordinator = CancellationCoordinator::new(&self.repo_path, &self.db_manager);
        let config = CancellationConfig {
            force: false,
            skip_process_cleanup: false,
            skip_branch_deletion: false,
        };

        coordinator.cancel_session_async(&session, config).await?;
        Ok(())
    }

    pub fn convert_session_to_draft(&self, name: &str) -> Result<String> {
        let session = self.db_manager.get_session_by_name(name)?;

        if session.session_state != SessionState::Running {
            return Err(anyhow!("Session '{name}' is not in running state"));
        }

        log::info!("Converting session '{name}' from running to spec (new entity flow)");

        let (spec_content, initial_prompt) = self
            .db_manager
            .get_session_task_content(&session.name)
            .unwrap_or((None, None));
        let preserved_content = spec_content.or(initial_prompt).unwrap_or_default();

        // Cancel the running session (cleans processes/worktree, keeps record as cancelled)
        self.cancel_session(name)?;

        // Create new spec entity; name collisions handled internally
        let spec = self.create_spec_session_with_agent(
            &session.name,
            &preserved_content,
            session.original_agent_type.as_deref(),
            session.original_skip_permissions,
            Some(&session.parent_branch),
            session.display_name.as_deref(),
        )?;

        log::info!(
            "Successfully converted session '{name}' to new spec '{}'",
            spec.name
        );

        Ok(spec.name)
    }

    /// Async-safe version of convert_session_to_draft that avoids blocking the Tokio runtime.
    pub async fn convert_session_to_draft_async(&self, name: &str) -> Result<String> {
        let session = self.db_manager.get_session_by_name(name)?;

        if session.session_state != SessionState::Running {
            return Err(anyhow!("Session '{name}' is not in running state"));
        }

        log::info!("Converting session '{name}' from running to spec (async flow)");

        let (spec_content, initial_prompt) = self
            .db_manager
            .get_session_task_content(&session.name)
            .unwrap_or((None, None));
        let preserved_content = spec_content.or(initial_prompt).unwrap_or_default();

        // Async cancellation (no nested runtimes)
        self.fast_cancel_session(name).await?;

        // Create new spec entity; name collisions handled internally
        let spec = self.create_spec_session_with_agent(
            &session.name,
            &preserved_content,
            session.original_agent_type.as_deref(),
            session.original_skip_permissions,
            Some(&session.parent_branch),
            session.display_name.as_deref(),
        )?;

        log::info!(
            "Successfully converted session '{name}' to new spec '{}' (async flow)",
            spec.name
        );

        Ok(spec.name)
    }

    pub fn convert_session_to_spec_temp_compat(&self, name: &str) -> Result<()> {
        self.convert_session_to_draft(name)?;
        Ok(())
    }

    pub fn get_session(&self, name: &str) -> Result<Session> {
        self.db_manager.get_session_by_name(name)
    }

    pub fn get_session_by_id(&self, id: &str) -> Result<Session> {
        self.db_manager.get_session_by_id(id)
    }

    pub fn get_spec(&self, name: &str) -> Result<Spec> {
        self.db_manager.get_spec_by_name(name)
    }

    pub fn get_session_task_content(&self, name: &str) -> Result<(Option<String>, Option<String>)> {
        self.db_manager.get_session_task_content(name)
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        self.db_manager.list_sessions()
    }

    pub fn list_specs(&self) -> Result<Vec<Spec>> {
        self.db_manager.list_specs()
    }

    pub fn update_git_stats(&self, session_id: &str) -> Result<()> {
        self.db_manager.update_git_stats(session_id)
    }

    pub fn cleanup_orphaned_worktrees(&self) -> Result<()> {
        self.utils.cleanup_orphaned_worktrees()
    }

    pub fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>> {
        let start_time = std::time::Instant::now();
        log::info!("[SES] list_enriched_sessions start");

        let sessions_start = std::time::Instant::now();
        let sessions = self.db_manager.list_sessions()?;
        let sessions_elapsed = sessions_start.elapsed().as_millis();
        log::info!(
            "[SES] list_sessions fetched {} rows in {}ms",
            sessions.len(),
            sessions_elapsed
        );

        let specs_start = std::time::Instant::now();
        let specs = self.db_manager.list_specs()?;
        let specs_elapsed = specs_start.elapsed().as_millis();
        log::info!(
            "[SES] list_specs fetched {} rows in {}ms",
            specs.len(),
            specs_elapsed
        );

        let spec_count = sessions
            .iter()
            .filter(|s| s.session_state == SessionState::Spec)
            .count();
        log::info!(
            "[SES] totals sessions={} specs_in_sessions={} specs_table={} non_specs={}",
            sessions.len(),
            spec_count,
            specs.len(),
            sessions.len().saturating_sub(spec_count)
        );

        let db_time = std::time::Duration::from_millis((sessions_elapsed + specs_elapsed) as u64);

        // Fetch global defaults once to avoid per-row DB hits
        let default_agent_type = self.db_manager.get_agent_type().ok();

        let bulk_stats_start = std::time::Instant::now();
        let session_ids: Vec<String> = sessions
            .iter()
            .filter(|s| {
                s.status != SessionStatus::Cancelled && s.session_state != SessionState::Spec
            })
            .map(|s| s.id.clone())
            .collect();
        let all_stats = self
            .db_manager
            .get_git_stats_bulk(&session_ids)
            .unwrap_or_else(|_| Vec::new());
        let stats_by_id: std::collections::HashMap<
            String,
            crate::domains::sessions::entity::GitStats,
        > = all_stats
            .into_iter()
            .map(|s| (s.session_id.clone(), s))
            .collect();
        let bulk_stats_time = bulk_stats_start.elapsed();
        log::info!(
            "list_enriched_sessions: stage=after_git_stats_bulk stats_loaded={} requested={} elapsed={}ms",
            stats_by_id.len(),
            session_ids.len(),
            bulk_stats_time.as_millis()
        );

        let mut enriched = Vec::new();
        let git_stats_total_time = std::time::Duration::ZERO;
        let mut worktree_check_time = std::time::Duration::ZERO;
        let mut session_count = 0;

        // Push specs (lightweight, no worktrees)
        for spec in specs {
            let worktree_path = self
                .repo_path
                .join(".schaltwerk")
                .join("specs")
                .join(&spec.name);
            let base_branch = self
                .resolve_parent_branch(None)
                .unwrap_or_else(|_| "main".to_string());

            let info = SessionInfo {
                session_id: spec.name.clone(),
                display_name: spec.display_name.clone(),
                version_group_id: None,
                version_number: None,
                branch: format!("specs/{}", spec.name),
                worktree_path: worktree_path.to_string_lossy().to_string(),
                base_branch: base_branch.clone(),
                original_base_branch: None,
                status: SessionStatusType::Spec,
                created_at: Some(spec.created_at),
                last_modified: Some(spec.updated_at),
                has_uncommitted_changes: Some(false),
                has_conflicts: Some(false),
                is_current: false,
                session_type: SessionType::Worktree,
                container_status: None,
                original_agent_type: default_agent_type.clone(),
                current_task: None,
                diff_stats: None,
                ready_to_merge: false,
                spec_content: Some(spec.content.clone()),
                session_state: SessionState::Spec,
            };

            enriched.push(EnrichedSession {
                info,
                status: None,
                terminals: Vec::new(),
            });
        }

        let mut stale_refresh_queue: Vec<(String, PathBuf, String)> = Vec::new();

        for session in sessions {
            if session.status == SessionStatus::Cancelled {
                continue;
            }

            session_count += 1;
            let session_start = std::time::Instant::now();
            log::debug!(
                "list_enriched_sessions: session={} stage=process_start status={:?} state={:?}",
                session.name,
                session.status,
                session.session_state
            );

            let is_spec_session = session.session_state == SessionState::Spec;
            if is_spec_session {
                log::debug!(
                    "list_enriched_sessions: session={} stage=spec skip_enrichment=true",
                    session.name
                );
                // Specs do not require git stats or worktree checks; return lightweight metadata
                let info = SessionInfo {
                    session_id: session.name.clone(),
                    display_name: session.display_name.clone(),
                    version_group_id: session.version_group_id.clone(),
                    version_number: session.version_number,
                    branch: session.branch.clone(),
                    worktree_path: session.worktree_path.to_string_lossy().to_string(),
                    base_branch: session.parent_branch.clone(),
                    original_base_branch: session.original_parent_branch.clone(),
                    status: SessionStatusType::Spec,
                    created_at: Some(session.created_at),
                    last_modified: session.last_activity,
                    has_uncommitted_changes: Some(false),
                    has_conflicts: Some(false),
                    is_current: false,
                    session_type: SessionType::Worktree,
                    container_status: None,
                    original_agent_type: session
                        .original_agent_type
                        .clone()
                        .or_else(|| default_agent_type.clone()),
                    current_task: session.initial_prompt.clone(),
                    diff_stats: None,
                    ready_to_merge: session.ready_to_merge,
                    spec_content: session.spec_content.clone(),
                    session_state: session.session_state.clone(),
                };

                enriched.push(EnrichedSession {
                    info,
                    status: None,
                    terminals: Vec::new(),
                });

                continue;
            }

            log::debug!(
                "Processing session '{}': status={:?}, session_state={:?}",
                session.name,
                session.status,
                session.session_state
            );

            // Check if worktree exists for running/reviewed sessions
            let worktree_check_start = std::time::Instant::now();
            log::debug!(
                "list_enriched_sessions: session={} stage=worktree_check:start path={}",
                session.name,
                session.worktree_path.display()
            );
            let worktree_exists = session.worktree_path.exists();
            let worktree_elapsed = worktree_check_start.elapsed();
            worktree_check_time += worktree_elapsed;
            log::debug!(
                "list_enriched_sessions: session={} stage=worktree_check:done exists={} elapsed={}ms",
                session.name,
                worktree_exists,
                worktree_elapsed.as_millis()
            );

            if !worktree_exists && !cfg!(test) {
                log::warn!(
                    "list_enriched_sessions: worktree missing for '{}' (status={:?}, state={:?}) at {}",
                    session.name,
                    session.status,
                    session.session_state,
                    session.worktree_path.display()
                );
            }

            let (git_stats, has_conflicts) = if worktree_exists {
                let mut cached_stats = stats_by_id.get(&session.id).cloned();
                let stale = cached_stats
                    .as_ref()
                    .map(|existing| {
                        // consider stats stale after 60s
                        const STALE_SECS: i64 = 60;
                        (chrono::Utc::now().timestamp() - existing.calculated_at.timestamp())
                            > STALE_SECS
                    })
                    .unwrap_or(true);
                // Serve cached stats immediately; queue stale ones for background refresh
                if stale {
                    if cfg!(test) {
                        if let Ok(mut fresh) = git::calculate_git_stats_fast(
                            &session.worktree_path,
                            &session.parent_branch,
                        ) {
                            fresh.session_id = session.id.clone();
                            let _ = self.db_manager.save_git_stats(&fresh);
                            cached_stats = Some(fresh);
                        }
                    } else {
                        stale_refresh_queue.push((
                            session.id.clone(),
                            session.worktree_path.clone(),
                            session.parent_branch.clone(),
                        ));
                    }
                }

                let has_conflicts = match git::has_conflicts(&session.worktree_path) {
                    Ok(value) => value,
                    Err(err) => {
                        log::warn!(
                            "Conflict detection failed for session '{}': {err}",
                            session.name
                        );
                        false
                    }
                };

                (cached_stats, Some(has_conflicts))
            } else {
                (None, None)
            };

            let has_uncommitted = git_stats
                .as_ref()
                .map(|s| s.has_uncommitted)
                .unwrap_or(false);

            let diff_stats = git_stats.as_ref().map(|stats| DiffStats {
                files_changed: stats.files_changed as usize,
                additions: stats.lines_added as usize,
                deletions: stats.lines_removed as usize,
                insertions: stats.lines_added as usize,
            });

            let status_type = if !worktree_exists && !cfg!(test) {
                SessionStatusType::Missing
            } else if has_uncommitted {
                SessionStatusType::Dirty
            } else {
                match session.status {
                    SessionStatus::Active => SessionStatusType::Active,
                    SessionStatus::Cancelled => SessionStatusType::Archived,
                    SessionStatus::Spec => SessionStatusType::Spec,
                }
            };

            let original_agent_type = session
                .original_agent_type
                .clone()
                .or_else(|| default_agent_type.clone());

            let info = SessionInfo {
                session_id: session.name.clone(),
                display_name: session.display_name.clone(),
                version_group_id: session.version_group_id.clone(),
                version_number: session.version_number,
                branch: session.branch.clone(),
                worktree_path: session.worktree_path.to_string_lossy().to_string(),
                base_branch: session.parent_branch.clone(),
                original_base_branch: session.original_parent_branch.clone(),
                status: status_type,
                created_at: Some(session.created_at),
                last_modified: session.last_activity,
                has_uncommitted_changes: Some(has_uncommitted),
                has_conflicts,
                is_current: false,
                session_type: SessionType::Worktree,
                container_status: None,
                original_agent_type: original_agent_type.or_else(|| default_agent_type.clone()),
                current_task: session.initial_prompt.clone(),
                diff_stats: diff_stats.clone(),
                ready_to_merge: session.ready_to_merge,
                spec_content: session.spec_content.clone(),
                session_state: session.session_state.clone(),
            };

            let terminals = vec![
                terminal_id_for_session_top(&session.name),
                terminal_id_for_session_bottom(&session.name),
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

        if !stale_refresh_queue.is_empty() {
            let db = self.db_manager.clone();
            tauri::async_runtime::spawn(async move {
                for (session_id, worktree, parent_branch) in stale_refresh_queue {
                    let refresh_start = Instant::now();
                    let result = tokio::task::spawn_blocking(move || {
                        git::calculate_git_stats_fast(&worktree, &parent_branch)
                    })
                    .await;

                    match result {
                        Ok(Ok(mut stats)) => {
                            stats.session_id = session_id.clone();
                            let _ = db.save_git_stats(&stats);
                            let elapsed = refresh_start.elapsed().as_millis();
                            if elapsed > 250 {
                                log::warn!(
                                    "Background git stats refresh for '{session_id}' took {elapsed}ms"
                                );
                            } else {
                                log::debug!(
                                    "Background git stats refresh for '{session_id}' completed in {elapsed}ms"
                                );
                            }
                        }
                        Ok(Err(err)) => {
                            log::warn!(
                                "Background git stats refresh failed for '{session_id}': {err}"
                            );
                        }
                        Err(join_err) => {
                            log::warn!(
                                "Background git stats task join failed for '{session_id}': {join_err}"
                            );
                        }
                    }
                }
            });
        }

        let total_elapsed = start_time.elapsed();
        log::info!(
            "list_enriched_sessions: Returning {} enriched sessions (total: {}ms, db: {}ms, git_stats: {}ms, worktree_checks: {}ms, avg per session: {}ms)",
            enriched.len(),
            total_elapsed.as_millis(),
            db_time.as_millis(),
            git_stats_total_time.as_millis(),
            worktree_check_time.as_millis(),
            if session_count > 0 {
                total_elapsed.as_millis() / session_count as u128
            } else {
                0
            }
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

    pub fn start_claude_in_session(&self, session_name: &str) -> Result<AgentLaunchSpec> {
        self.start_claude_in_session_with_restart(session_name, false)
    }

    pub fn start_claude_in_session_with_restart(
        &self,
        session_name: &str,
        force_restart: bool,
    ) -> Result<AgentLaunchSpec> {
        self.start_claude_in_session_with_restart_and_binary(
            session_name,
            force_restart,
            &HashMap::new(),
            None,
        )
    }

    pub fn start_claude_in_session_with_binary(
        &self,
        session_name: &str,
        binary_paths: &HashMap<String, String>,
    ) -> Result<AgentLaunchSpec> {
        self.start_claude_in_session_with_restart_and_binary(
            session_name,
            false,
            binary_paths,
            None,
        )
    }

    pub fn start_claude_in_session_with_args(
        &self,
        session_name: &str,
        _cli_args: Option<&str>,
    ) -> Result<AgentLaunchSpec> {
        self.start_claude_in_session_with_args_and_binary(session_name, _cli_args, &HashMap::new())
    }

    pub fn start_claude_in_session_with_args_and_binary(
        &self,
        session_name: &str,
        _cli_args: Option<&str>,
        binary_paths: &HashMap<String, String>,
    ) -> Result<AgentLaunchSpec> {
        self.start_claude_in_session_with_restart_and_binary(
            session_name,
            false,
            binary_paths,
            None,
        )
    }

    pub fn start_claude_in_session_with_restart_and_binary(
        &self,
        session_name: &str,
        force_restart: bool,
        binary_paths: &HashMap<String, String>,
        _amp_mcp_servers: Option<&HashMap<String, crate::domains::settings::McpServerConfig>>,
    ) -> Result<AgentLaunchSpec> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        let skip_permissions = session
            .original_skip_permissions
            .unwrap_or(self.db_manager.get_skip_permissions()?);
        let requested_agent_type = session
            .original_agent_type
            .clone()
            .unwrap_or(self.db_manager.get_agent_type()?);
        let agent_type = resolve_launch_agent(&requested_agent_type, binary_paths)?;

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
            log::info!(
                "Session manager: find_resumable_claude_session_fast returned: {resumable_session_id:?}"
            );

            // Determine session_id and prompt based on force_restart and existing session
            let (session_id_to_use, prompt_to_use, did_start_fresh) = if force_restart {
                // Explicit restart - always use initial prompt, no session resumption
                log::info!(
                    "Session manager: Force restarting Claude session '{}' with initial_prompt={:?}",
                    session_name,
                    session.initial_prompt
                );
                (None, session.initial_prompt.as_deref(), true)
            } else if let Some(session_id) = resumable_session_id {
                // Session exists with actual conversation content and not forcing restart - resume with session ID
                log::info!(
                    "Session manager: Resuming existing Claude session '{}' with session_id='{}' in worktree: {}",
                    session_name,
                    session_id,
                    session.worktree_path.display()
                );
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

            log::info!(
                "Session manager: Final decision - session_id_to_use={session_id_to_use:?}, prompt_to_use={prompt_to_use:?}"
            );

            // Only mark session as prompted if we're actually using the prompt
            if prompt_to_use.is_some() {
                self.cache_manager
                    .mark_session_prompted(&session.worktree_path);
            }

            // If we started fresh and resume had been disallowed, flip resume_allowed back to true for future resumes
            if did_start_fresh
                && !resume_allowed
                && let Err(err) = self
                    .db_manager
                    .set_session_resume_allowed(&session.id, true)
            {
                log::warn!(
                    "Failed to re-enable resume for session {}: {err}",
                    session.id
                );
            }

            let binary_path = self.utils.get_effective_binary_path_with_override(
                "claude",
                binary_paths.get("claude").map(|s| s.as_str()),
            );
            if let Some(spec) = registry.build_launch_spec(
                "claude",
                &session.worktree_path,
                session_id_to_use.as_deref(),
                prompt_to_use,
                skip_permissions,
                Some(&binary_path),
            ) {
                return Ok(spec);
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
            log::info!(
                "Session manager: resume_allowed={resume_allowed}, find_codex_resume_path returned: {:?}",
                resume_path.as_ref().map(|p| p.display().to_string())
            );
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

            log::info!(
                "Session manager: Final decision - session_id_to_use={session_id_to_use:?}, prompt_to_use={prompt_to_use:?}"
            );

            // Only mark session as prompted if we're actually using the prompt
            if prompt_to_use.is_some() {
                self.cache_manager
                    .mark_session_prompted(&session.worktree_path);
            }

            // If we started fresh and resume had been disallowed, flip resume_allowed back to true for future resumes
            if did_start_fresh
                && !resume_allowed
                && let Err(err) = self
                    .db_manager
                    .set_session_resume_allowed(&session.id, true)
            {
                log::warn!(
                    "Failed to re-enable resume for session {}: {err}",
                    session.id
                );
            }

            let binary_path = self.utils.get_effective_binary_path_with_override(
                "codex",
                binary_paths.get("codex").map(|s| s.as_str()),
            );
            if let Some(spec) = registry.build_launch_spec(
                "codex",
                &session.worktree_path,
                session_id_to_use.as_deref(),
                prompt_to_use,
                skip_permissions,
                Some(&binary_path),
            ) {
                return Ok(spec);
            }
        }

        if agent_type == "opencode" {
            log::info!(
                "Session manager: Starting OpenCode agent for session '{}' in worktree: {}",
                session_name,
                session.worktree_path.display()
            );
            log::info!(
                "Session manager: force_restart={}, session.initial_prompt={:?}, resume_allowed={}",
                force_restart,
                session.initial_prompt,
                session.resume_allowed
            );

            let resume_info = if !force_restart && session.resume_allowed {
                crate::domains::agents::opencode::find_opencode_session(&session.worktree_path)
            } else {
                None
            };

            if let Some(info) = resume_info.as_ref() {
                log::info!(
                    "Session manager: OpenCode resume probe found session '{}' (has_history={})",
                    info.id,
                    info.has_history
                );
            } else {
                log::info!("Session manager: OpenCode resume probe found no resumable session");
            }

            let (session_id_to_use, prompt_to_use, did_start_fresh) = if force_restart {
                log::info!(
                    "Session manager: Force restarting OpenCode session '{}' with initial_prompt={:?}",
                    session_name,
                    session.initial_prompt
                );
                (None, session.initial_prompt.as_deref(), true)
            } else if let Some(info) = resume_info.as_ref().filter(|info| info.has_history) {
                log::info!(
                    "Session manager: Resuming OpenCode session '{}' via --session {}",
                    session_name,
                    info.id
                );
                (Some(info.id.clone()), None, false)
            } else {
                if let Some(info) = resume_info.as_ref() {
                    log::info!(
                        "Session manager: OpenCode session '{}' lacks history; starting fresh",
                        info.id
                    );
                } else {
                    log::info!(
                        "Session manager: No OpenCode history detected; starting fresh with initial_prompt={:?}",
                        session.initial_prompt
                    );
                }
                (None, session.initial_prompt.as_deref(), true)
            };

            log::info!(
                "Session manager: Final OpenCode decision - resume_id={:?}, using_prompt={}, did_start_fresh={}",
                session_id_to_use.as_ref(),
                prompt_to_use.is_some(),
                did_start_fresh
            );

            if prompt_to_use.is_some() {
                self.cache_manager
                    .mark_session_prompted(&session.worktree_path);
            }

            if did_start_fresh && !session.resume_allowed {
                let _ = self
                    .db_manager
                    .set_session_resume_allowed(&session.id, true);
            }

            let binary_path = self.utils.get_effective_binary_path_with_override(
                "opencode",
                binary_paths.get("opencode").map(|s| s.as_str()),
            );
            if let Some(spec) = registry.build_launch_spec(
                "opencode",
                &session.worktree_path,
                session_id_to_use.as_deref(),
                prompt_to_use,
                skip_permissions,
                Some(&binary_path),
            ) {
                return Ok(spec);
            }
        }

        // Special handling for Amp with MCP servers
        if agent_type == "amp" {
            self.cache_manager
                .mark_session_prompted(&session.worktree_path);
            let prompt_to_use = session.initial_prompt.as_deref();

            let binary_path = self.utils.get_effective_binary_path_with_override(
                &agent_type,
                binary_paths.get(&agent_type).map(|s| s.as_str()),
            );

            let config = crate::domains::agents::amp::AmpConfig {
                binary_path: Some(binary_path.clone()),
            };

            let command = crate::domains::agents::amp::build_amp_command_with_config(
                &session.worktree_path,
                session.amp_thread_id.as_deref(),
                prompt_to_use,
                skip_permissions,
                Some(&config),
            );

            return Ok(crate::domains::agents::AgentLaunchSpec::new(
                command,
                session.worktree_path.clone(),
            ));
        }

        // For all other agents, use the registry directly
        self.cache_manager
            .mark_session_prompted(&session.worktree_path);

        let binary_path = self.utils.get_effective_binary_path_with_override(
            &agent_type,
            binary_paths.get(&agent_type).map(|s| s.as_str()),
        );

        let session_id = if !force_restart && session.resume_allowed {
            registry
                .get(&agent_type)
                .and_then(|adapter| adapter.find_session(&session.worktree_path))
        } else {
            None
        };

        let did_start_fresh = session_id.is_none();

        let prompt_to_use = if session_id.is_some() {
            None
        } else {
            session.initial_prompt.as_deref()
        };

        if let Some(spec) = registry.build_launch_spec(
            &agent_type,
            &session.worktree_path,
            session_id.as_deref(),
            prompt_to_use,
            skip_permissions,
            Some(&binary_path),
        ) {
            if did_start_fresh && !session.resume_allowed {
                let _ = self
                    .db_manager
                    .set_session_resume_allowed(&session.id, true);
            }
            Ok(spec)
        } else {
            log::error!("Unknown agent type '{agent_type}' for session '{session_name}'");
            let supported = registry.supported_agents().join(", ");
            Err(anyhow!(
                "Unsupported agent type: {agent_type}. Supported types are: {supported}"
            ))
        }
    }

    pub fn start_claude_in_orchestrator(&self) -> Result<AgentLaunchSpec> {
        self.start_claude_in_orchestrator_with_args(None)
    }

    pub fn start_claude_in_orchestrator_fresh(&self) -> Result<AgentLaunchSpec> {
        self.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new())
    }

    pub fn start_claude_in_orchestrator_fresh_with_binary(
        &self,
        binary_paths: &HashMap<String, String>,
    ) -> Result<AgentLaunchSpec> {
        self.start_orchestrator_internal(binary_paths, false)
    }

    pub fn start_claude_in_orchestrator_with_binary(
        &self,
        binary_paths: &HashMap<String, String>,
    ) -> Result<AgentLaunchSpec> {
        self.start_claude_in_orchestrator_with_args_and_binary(None, binary_paths)
    }

    pub fn start_claude_in_orchestrator_with_args(
        &self,
        _cli_args: Option<&str>,
    ) -> Result<AgentLaunchSpec> {
        self.start_claude_in_orchestrator_with_args_and_binary(_cli_args, &HashMap::new())
    }

    pub fn start_claude_in_orchestrator_with_args_and_binary(
        &self,
        _cli_args: Option<&str>,
        binary_paths: &HashMap<String, String>,
    ) -> Result<AgentLaunchSpec> {
        self.start_orchestrator_internal(binary_paths, true)
    }

    fn start_orchestrator_internal(
        &self,
        binary_paths: &HashMap<String, String>,
        resume_session: bool,
    ) -> Result<AgentLaunchSpec> {
        let mode = if resume_session { "resumable" } else { "fresh" };
        log::info!(
            "Building {mode} orchestrator command for repo: {}",
            self.repo_path.display()
        );

        if !self.repo_path.exists() {
            return Err(anyhow!(
                "Repository path does not exist: {}. Please open a valid project folder.",
                self.repo_path.display()
            ));
        }

        if !self.repo_path.join(".git").exists() {
            return Err(anyhow!(
                "The folder '{}' is not a git repository. The orchestrator requires a git repository to function.",
                self.repo_path.display()
            ));
        }

        let skip_permissions = self.db_manager.get_orchestrator_skip_permissions()?;
        let requested_agent_type = self.db_manager.get_orchestrator_agent_type()?;
        let agent_type = resolve_launch_agent(&requested_agent_type, binary_paths)?;

        log::info!("Orchestrator agent type: {agent_type}, skip_permissions: {skip_permissions}, resume: {resume_session}");

        self.build_orchestrator_command(&agent_type, skip_permissions, binary_paths, resume_session)
    }

    fn build_orchestrator_command(
        &self,
        agent_type: &str,
        skip_permissions: bool,
        binary_paths: &HashMap<String, String>,
        resume_session: bool,
    ) -> Result<AgentLaunchSpec> {
        let registry = crate::domains::agents::unified::AgentRegistry::new();

        // Special handling for Claude orchestrator resumes (deterministic session lookup)
        if agent_type == "claude" {
            let binary_path = self.utils.get_effective_binary_path_with_override(
                "claude",
                binary_paths.get("claude").map(|s| s.as_str()),
            );

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
                        log::info!(
                            "Orchestrator: No existing Claude orchestrator sessions found in main repo, starting fresh"
                        );
                        None
                    }
                }
            } else {
                None
            };

            if let Some(spec) = registry.build_launch_spec(
                "claude",
                &self.repo_path,
                session_id_to_use.as_deref(),
                None,
                skip_permissions,
                Some(&binary_path),
            ) {
                return Ok(spec);
            }
        }

        // For all other agents, use the registry
        let binary_path = self.utils.get_effective_binary_path_with_override(
            agent_type,
            binary_paths.get(agent_type).map(|s| s.as_str()),
        );

        let session_id = if resume_session {
            registry
                .get(agent_type)
                .and_then(|a| a.find_session(&self.repo_path))
        } else {
            None
        };

        if let Some(spec) = registry.build_launch_spec(
            agent_type,
            &self.repo_path,
            session_id.as_deref(),
            None,
            skip_permissions,
            Some(&binary_path),
        ) {
            Ok(spec)
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
            return Err(anyhow!(
                "Cannot mark spec session '{session_name}' as reviewed. Start the spec first with schaltwerk_draft_start."
            ));
        }

        if session.ready_to_merge {
            return Err(anyhow!(
                "Session '{session_name}' is already marked as reviewed"
            ));
        }

        self.mark_session_ready(session_name)?;
        Ok(())
    }

    pub fn convert_session_to_spec(&self, session_name: &str) -> Result<String> {
        // Get session and validate state
        let session = self.db_manager.get_session_by_name(session_name)?;

        // Validate that the session is in a valid state for conversion
        if session.session_state == SessionState::Spec {
            return Err(anyhow!("Session '{session_name}' is already a spec"));
        }

        // Use existing convert_session_to_draft logic
        self.convert_session_to_draft(session_name)
    }

    pub fn start_spec_session_with_config(
        &self,
        session_name: &str,
        base_branch: Option<&str>,
        version_group_id: Option<&str>,
        version_number: Option<i32>,
        agent_type: Option<&str>,
        skip_permissions: Option<bool>,
    ) -> Result<Session> {
        // Start the draft session first
        let mut session =
            self.start_spec_session(session_name, base_branch, version_group_id, version_number)?;

        // Apply session-scoped original settings without mutating globals
        if agent_type.is_some() || skip_permissions.is_some() {
            let default_agent = self
                .db_manager
                .get_agent_type()
                .unwrap_or_else(|_| "claude".to_string());
            let default_skip = self.db_manager.get_skip_permissions().unwrap_or(false);

            let effective_agent = agent_type
                .map(|a| a.to_string())
                .or_else(|| session.original_agent_type.clone())
                .unwrap_or(default_agent);

            let effective_skip = skip_permissions
                .or(session.original_skip_permissions)
                .unwrap_or(default_skip);

            if let Err(e) = self.db_manager.set_session_original_settings(
                &session.id,
                &effective_agent,
                effective_skip,
            ) {
                warn!("Failed to set session-scoped settings for '{session_name}': {e}");
            } else {
                session.original_agent_type = Some(effective_agent);
                session.original_skip_permissions = Some(effective_skip);
            }

            // Refresh the session to include persisted values (resume flags, etc.)
            session = self.db_manager.get_session_by_id(&session.id)?;
        }

        Ok(session)
    }

    pub fn mark_session_ready(&self, session_name: &str) -> Result<bool> {
        let session = self.db_manager.get_session_by_name(session_name)?;

        let ready_to_merge = !git::has_uncommitted_changes(&session.worktree_path)?;

        self.db_manager
            .update_session_ready_to_merge(&session.id, ready_to_merge)?;
        self.db_manager
            .update_session_state(&session.id, SessionState::Reviewed)?;

        if let Err(e) = self.db_manager.update_git_stats(&session.id) {
            log::warn!("mark_session_ready: failed to refresh git stats for '{session_name}': {e}");
        }

        Ok(ready_to_merge)
    }

    pub fn unmark_session_ready(&self, session_name: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        self.db_manager
            .update_session_ready_to_merge(&session.id, false)?;
        if session.session_state != SessionState::Spec {
            self.db_manager
                .update_session_state(&session.id, SessionState::Running)?;
        }
        Ok(())
    }

    pub fn set_session_ready_flag(&self, session_name: &str, ready: bool) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        self.db_manager
            .update_session_ready_to_merge(&session.id, ready)?;
        Ok(())
    }

    // When a follow-up message arrives for a reviewed session, it should move back to running.
    // Only act if the session is actually marked reviewed (session_state = Reviewed).
    // Returns true if a change was applied, false if no-op (not reviewed/spec/missing flags).
    pub fn unmark_reviewed_on_follow_up(&self, session_name: &str) -> Result<bool> {
        let session = match self.db_manager.get_session_by_name(session_name) {
            Ok(s) => s,
            Err(_) => {
                // Specs (stored separately) have no follow-up behavior; treat as no-op
                if self.db_manager.get_spec_by_name(session_name).is_ok() {
                    return Ok(false);
                }
                return Err(anyhow!("Session '{session_name}' not found"));
            }
        };

        // Do nothing for specs (cannot receive follow-ups into terminals)
        if session.session_state == SessionState::Spec {
            return Ok(false);
        }

        if session.session_state == SessionState::Reviewed {
            // Clear review flag/state and ensure state is Running for UI consistency
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

    pub fn create_spec_session(&self, name: &str, spec_content: &str) -> Result<Spec> {
        self.create_spec_session_with_agent(name, spec_content, None, None, None, None)
    }

    pub fn create_spec_session_with_agent(
        &self,
        name: &str,
        spec_content: &str,
        agent_type: Option<&str>,
        _skip_permissions: Option<bool>,
        _parent_branch_override: Option<&str>,
        display_name: Option<&str>,
    ) -> Result<Spec> {
        log::info!(
            "Creating spec '{}' (agent hints: {:?}) in repository: {}",
            name,
            agent_type,
            self.repo_path.display()
        );

        let repo_lock = self.cache_manager.get_repo_lock();
        let _guard = repo_lock.lock().unwrap();

        if !git::is_valid_session_name(name) {
            return Err(anyhow!(
                "Invalid spec name: use only letters, numbers, hyphens, and underscores"
            ));
        }

        // Reuse session name uniqueness logic to avoid future branch/worktree collisions
        let (unique_name, _, _) = self.utils.find_unique_session_paths(name)?;

        let spec_id = SessionUtils::generate_session_id();
        let repo_name = self.utils.get_repo_name()?;
        let now = Utc::now();

        let spec = Spec {
            id: spec_id,
            name: unique_name.clone(),
            display_name: display_name.map(|s| s.to_string()),
            repository_path: self.repo_path.clone(),
            repository_name: repo_name,
            content: spec_content.to_string(),
            created_at: now,
            updated_at: now,
        };

        self.db_manager.create_spec(&spec)?;

        // cache spec content for quick fetches
        crate::domains::sessions::cache::cache_spec_content(
            &self.repo_path,
            &spec.name,
            (Some(spec_content.to_string()), None),
        );

        self.cache_manager.unreserve_name(&unique_name);
        Ok(spec)
    }

    fn spec_to_virtual_session(&self, spec: Spec) -> Session {
        let spec_name = spec.name.clone();
        let worktree_path = self
            .repo_path
            .join(".schaltwerk")
            .join("specs")
            .join(&spec_name);
        let branch = format!("specs/{spec_name}");

        Session {
            id: spec.id,
            name: spec_name.clone(),
            display_name: spec.display_name,
            version_group_id: None,
            version_number: None,
            repository_path: spec.repository_path.clone(),
            repository_name: spec.repository_name,
            branch,
            parent_branch: self
                .resolve_parent_branch(None)
                .unwrap_or_else(|_| "main".to_string()),
            original_parent_branch: None,
            worktree_path,
            status: SessionStatus::Spec,
            created_at: spec.created_at,
            updated_at: spec.updated_at,
            last_activity: Some(spec.updated_at),
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: Some(spec.content),
            session_state: SessionState::Spec,
            resume_allowed: false,
            amp_thread_id: None,
        }
    }

    pub fn create_and_start_spec_session(
        &self,
        name: &str,
        spec_content: &str,
        base_branch: Option<&str>,
        version_group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<Session> {
        log::info!(
            "Creating and starting spec '{}' in repository: {}",
            name,
            self.repo_path.display()
        );

        let spec =
            self.create_spec_session_with_agent(name, spec_content, None, None, base_branch, None)?;
        let session =
            self.start_spec_session(&spec.name, base_branch, version_group_id, version_number)?;
        Ok(session)
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
    ) -> Result<Session> {
        // Reuse the existing flow to create and start
        let session = self.create_and_start_spec_session(
            name,
            spec_content,
            base_branch,
            version_group_id,
            version_number,
        )?;

        // Override original settings if provided, otherwise keep globals already stored
        if agent_type.is_some() || skip_permissions.is_some() {
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

        Ok(session)
    }

    pub fn start_spec_session(
        &self,
        spec_name: &str,
        base_branch: Option<&str>,
        version_group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<Session> {
        log::info!(
            "Starting spec '{}' in repository: {}",
            spec_name,
            self.repo_path.display()
        );

        let spec = self
            .db_manager
            .get_spec_by_name(spec_name)
            .map_err(|e| anyhow!("Spec '{spec_name}' not found: {e}"))?;

        let parent_branch = base_branch
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| self.resolve_parent_branch(None).ok())
            .ok_or_else(|| anyhow!("Failed to resolve base branch for spec '{spec_name}'"))?;

        let effective_group_id = version_group_id.map(|s| s.to_string());
        let effective_version_number = version_number;

        let mut session = self.create_session_with_auto_flag(
            &spec.name,
            Some(&spec.content),
            Some(&parent_branch),
            false,
            effective_group_id.as_deref(),
            effective_version_number,
        )?;

        if let Some(display_name) = spec.display_name.clone() {
            if !self
                .apply_display_name_to_session(&mut session, &display_name)
                .unwrap_or(false)
            {
                if let Err(e) = self
                    .db_manager
                    .db
                    .set_pending_name_generation(&session.id, true)
                {
                    log::warn!(
                        "Failed to mark session '{}' for name generation fallback: {e}",
                        session.name
                    );
                } else {
                    session.pending_name_generation = true;
                }
            }
        } else if let Err(e) = self
            .db_manager
            .db
            .set_pending_name_generation(&session.id, true)
        {
            log::warn!(
                "Failed to set pending_name_generation for session '{}': {e}",
                session.name
            );
        } else {
            session.pending_name_generation = true;
        }

        // Gate resume until first start after spec conversion
        let _ = self
            .db_manager
            .set_session_resume_allowed(&session.id, false);
        session.resume_allowed = false;

        // spec fulfilled -> delete
        self.db_manager.delete_spec(&spec.id)?;
        crate::domains::sessions::cache::invalidate_spec_content(&self.repo_path, &spec.name);

        Ok(session)
    }

    pub fn update_session_state(&self, session_name: &str, state: SessionState) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        self.db_manager.update_session_state(&session.id, state)?;
        Ok(())
    }

    pub fn spawn_amp_thread_watcher(&self, session_name: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;

        if session.original_agent_type.as_deref() != Some("amp") {
            return Ok(());
        }

        if session.amp_thread_id.is_some() {
            log::debug!(
                "Session '{session_name}' already has amp_thread_id stored; skipping watcher"
            );
            return Ok(());
        }

        let session_id = session.id.clone();
        let session_name = session_name.to_string();
        let db_manager = self.db_manager.clone();

        tokio::spawn(async move {
            log::info!(
                "Amp thread watcher spawned for session '{session_name}' (id: {session_id})"
            );

            if let Some(thread_id) =
                crate::domains::agents::amp::watch_amp_thread_creation(30).await
            {
                log::info!(
                    "Amp thread watcher: Detected thread '{thread_id}' for session '{session_name}'"
                );

                if let Err(e) = db_manager.set_session_amp_thread_id(&session_id, &thread_id) {
                    log::error!(
                        "Failed to store amp_thread_id '{thread_id}' for session '{session_name}': {e}"
                    );
                }
            } else {
                log::warn!(
                    "Amp thread watcher timeout for session '{session_name}': no new thread detected"
                );
            }
        });

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
        let spec = self
            .db_manager
            .get_spec_by_name(session_name)
            .map_err(|e| anyhow::anyhow!("Cannot update spec '{session_name}': {e}"))?;

        self.db_manager
            .update_spec_content_by_id(&spec.id, content)?;
        info!(
            "SessionCore: Successfully updated spec content in database for session '{session_name}'"
        );
        Ok(())
    }

    pub fn append_spec_content(&self, session_name: &str, content: &str) -> Result<()> {
        info!(
            "SessionCore: Appending spec content for session '{}', additional content length: {}",
            session_name,
            content.len()
        );
        let spec = self
            .db_manager
            .get_spec_by_name(session_name)
            .map_err(|e| anyhow::anyhow!("Cannot append content for spec '{session_name}': {e}"))?;

        let combined = if spec.content.is_empty() {
            content.to_string()
        } else {
            format!("{}\n{}", spec.content, content)
        };

        self.db_manager
            .update_spec_content_by_id(&spec.id, &combined)?;
        info!(
            "SessionCore: Successfully appended spec content in database for session '{session_name}'"
        );
        Ok(())
    }

    pub fn list_sessions_by_state(&self, state: SessionState) -> Result<Vec<Session>> {
        if state == SessionState::Spec {
            let specs = self.db_manager.list_specs()?;
            let sessions = specs
                .into_iter()
                .map(|spec| self.spec_to_virtual_session(spec))
                .collect();
            return Ok(sessions);
        }

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
        // Only archive specs (new table)
        let spec = self
            .db_manager
            .get_spec_by_name(name)
            .map_err(|e| anyhow!("Spec '{name}' not found for archive: {e}"))?;

        let content = spec.content.clone();

        let archived = ArchivedSpec {
            id: Uuid::new_v4().to_string(),
            session_name: spec.name.clone(),
            repository_path: self.repo_path.clone(),
            repository_name: spec.repository_name.clone(),
            content,
            archived_at: Utc::now(),
        };

        // Insert into archive, then delete the session
        self.db_manager.db.insert_archived_spec(&archived)?;

        // Physically remove spec from DB to declutter
        self.db_manager.delete_spec(&spec.id)?;
        crate::domains::sessions::cache::invalidate_spec_content(&self.repo_path, name);

        // Enforce archive limit for this repository
        self.db_manager.db.enforce_archive_limit(&self.repo_path)?;

        log::info!("Archived spec '{name}' and removed from active specs");
        Ok(())
    }

    pub fn list_archived_specs(&self) -> Result<Vec<ArchivedSpec>> {
        self.db_manager.db.list_archived_specs(&self.repo_path)
    }

    pub fn restore_archived_spec(&self, archived_id: &str, new_name: Option<&str>) -> Result<Spec> {
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
    pub fn db_ref(&self) -> &Database {
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
            if let Some(name) = head.shorthand()
                && name != session.branch
            {
                log::warn!(
                    "Discard file: HEAD shorthand '{}' != session branch '{}' (continuing defensively)",
                    name,
                    session.branch
                );
            }
        } else {
            log::warn!("Discard file: unable to read HEAD; continuing defensively");
        }

        // Prevent touching our internal control area
        if rel_file_path.starts_with(".schaltwerk/") {
            return Err(anyhow!("Refusing to discard changes under .schaltwerk"));
        }

        let path = std::path::Path::new(rel_file_path);
        crate::domains::git::worktrees::discard_path_in_worktree(
            &session.worktree_path,
            path,
            Some(&session.parent_branch),
        )
    }

    pub fn mark_session_prompted(&self, worktree_path: &std::path::Path) {
        self.cache_manager.mark_session_prompted(worktree_path);
    }
}

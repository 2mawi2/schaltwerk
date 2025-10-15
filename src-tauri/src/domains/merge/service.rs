use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use git2::{build::CheckoutBuilder, BranchType, MergeOptions, Oid, Repository};
use log::{debug, error, info, warn};
use tokio::task;
use tokio::time::timeout;

use crate::domains::git::operations::{has_uncommitted_changes, uncommitted_sample_paths};
use crate::domains::merge::lock;
use crate::domains::merge::types::{MergeMode, MergeOutcome, MergePreview, MergeState};
use crate::domains::sessions::entity::SessionState;
use crate::domains::sessions::service::SessionManager;
use crate::schaltwerk_core::database::Database;

const MERGE_TIMEOUT: Duration = Duration::from_secs(180);
const OPERATION_LABEL: &str = "merge_session";
const CONFLICT_SAMPLE_LIMIT: usize = 5;

#[derive(Clone)]
struct SessionMergeContext {
    session_id: String,
    session_name: String,
    repo_path: PathBuf,
    worktree_path: PathBuf,
    session_branch: String,
    parent_branch: String,
    session_oid: Oid,
    parent_oid: Oid,
}

pub struct MergeService {
    db: Database,
    repo_path: PathBuf,
}

impl MergeService {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        Self { db, repo_path }
    }

    fn assess_context(&self, context: &SessionMergeContext) -> Result<MergeState> {
        let repo = Repository::open(&context.repo_path).with_context(|| {
            format!(
                "Failed to open git repository at {}",
                context.repo_path.display()
            )
        })?;

        compute_merge_state(
            &repo,
            context.session_oid,
            context.parent_oid,
            &context.session_branch,
            &context.parent_branch,
        )
    }

    fn session_manager(&self) -> SessionManager {
        SessionManager::new(self.db.clone(), self.repo_path.clone())
    }

    pub fn preview(&self, session_name: &str) -> Result<MergePreview> {
        let context = self.prepare_context(session_name)?;
        let default_message = format!(
            "Merge session {} into {}",
            context.session_name, context.parent_branch
        );

        // Compose human-readable commands for the UI preview only. The merge implementation
        // uses libgit2 directly; these commands are never executed by the backend.
        let squash_commands = vec![
            format!("git rebase {}", context.parent_branch),
            format!("git reset --soft {}", context.parent_branch),
            "git commit -m \"<your message>\"".to_string(),
        ];

        let reapply_commands = vec![
            format!("git rebase {}", context.parent_branch),
            format!(
                "git update-ref refs/heads/{} $(git rev-parse HEAD)",
                context.parent_branch
            ),
        ];

        let assessment = self.assess_context(&context)?;

        Ok(MergePreview {
            session_branch: context.session_branch,
            parent_branch: context.parent_branch,
            squash_commands,
            reapply_commands,
            default_commit_message: default_message,
            has_conflicts: assessment.has_conflicts,
            conflicting_paths: assessment.conflicting_paths,
            is_up_to_date: assessment.is_up_to_date,
        })
    }

    pub async fn merge(
        &self,
        session_name: &str,
        mode: MergeMode,
        commit_message: Option<String>,
    ) -> Result<MergeOutcome> {
        let context = self.prepare_context(session_name)?;
        let assessment = self.assess_context(&context)?;

        if assessment.has_conflicts {
            let hint = if assessment.conflicting_paths.is_empty() {
                String::new()
            } else {
                format!(
                    " Conflicting paths: {}",
                    assessment.conflicting_paths.join(", ")
                )
            };
            return Err(anyhow!(
                "Session '{}' has merge conflicts when applying '{}' into '{}'.{}",
                context.session_name,
                context.parent_branch,
                context.session_branch,
                hint
            ));
        }

        if assessment.is_up_to_date {
            return Err(anyhow!(
                "Session '{}' has no commits to merge into parent branch '{}'.",
                context.session_name,
                context.parent_branch
            ));
        }

        let commit_message = match mode {
            MergeMode::Squash => {
                let message = commit_message
                    .and_then(|m| {
                        let trimmed = m.trim().to_string();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed)
                        }
                    })
                    .ok_or_else(|| anyhow!("Commit message is required for squash merges"))?;
                Some(message)
            }
            MergeMode::Reapply => commit_message
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty()),
        };

        let lock_guard = lock::try_acquire(&context.session_name).ok_or_else(|| {
            anyhow!(
                "Merge already running for session '{}'",
                context.session_name
            )
        })?;

        let context_clone = context.clone();
        let commit_message_clone = commit_message.clone();

        let result = timeout(
            MERGE_TIMEOUT,
            self.perform_merge(context_clone.clone(), mode, commit_message_clone),
        )
        .await;

        drop(lock_guard);

        let outcome = match result {
            Ok(inner) => inner?,
            Err(_) => {
                warn!(
                    "Merge for session '{}' timed out after {:?}",
                    context.session_name, MERGE_TIMEOUT
                );
                return Err(anyhow!("Merge operation timed out after 180 seconds"));
            }
        }?;

        self.after_success(&context)?;

        Ok(outcome)
    }

    fn after_success(&self, context: &SessionMergeContext) -> Result<()> {
        info!(
            "{OPERATION_LABEL}: refreshing session '{session_name}' state after successful merge",
            session_name = context.session_name
        );
        let manager = self.session_manager();
        manager.update_session_state(&context.session_name, SessionState::Reviewed)?;

        if let Err(err) = manager.update_git_stats(&context.session_id) {
            warn!(
                "{OPERATION_LABEL}: failed to refresh git stats for '{session_name}': {err}",
                session_name = context.session_name
            );
        }

        Ok(())
    }

    fn prepare_context(&self, session_name: &str) -> Result<SessionMergeContext> {
        let manager = self.session_manager();
        let session = manager
            .get_session(session_name)
            .with_context(|| format!("Session '{session_name}' not found"))?;

        if session.session_state == SessionState::Spec {
            return Err(anyhow!(
                "Session '{session_name}' is still a spec. Start it before merging."
            ));
        }

        if !session.ready_to_merge {
            return Err(anyhow!(
                "Session '{session_name}' is not marked ready to merge"
            ));
        }

        if !session.worktree_path.exists() {
            return Err(anyhow!(
                "Worktree for session '{session_name}' is missing at {}",
                session.worktree_path.display()
            ));
        }

        if has_uncommitted_changes(&session.worktree_path)? {
            let sample = uncommitted_sample_paths(&session.worktree_path, 3)
                .unwrap_or_default()
                .join(", ");
            return Err(anyhow!(
                "Session '{session_name}' has uncommitted changes. Clean the worktree before merging.{}",
                if sample.is_empty() {
                    String::new()
                } else {
                    format!(" Offending paths: {sample}")
                }
            ));
        }

        let parent_branch = session.parent_branch.trim();
        if parent_branch.is_empty() {
            return Err(anyhow!(
                "Session '{session_name}' has no recorded parent branch"
            ));
        }

        let repo = Repository::open(&session.repository_path).with_context(|| {
            format!(
                "Failed to open git repository at {}",
                session.repository_path.display()
            )
        })?;

        let parent = parent_branch;
        let parent_ref = find_branch(&repo, parent).with_context(|| {
            format!("Parent branch '{parent}' not found for session '{session_name}'")
        })?;
        let parent_oid = parent_ref
            .get()
            .target()
            .ok_or_else(|| anyhow!("Parent branch '{parent}' has no target"))?;

        let branch = &session.branch;
        let session_ref = find_branch(&repo, branch).with_context(|| {
            format!("Session branch '{branch}' not found for session '{session_name}'")
        })?;
        let session_oid = session_ref
            .get()
            .target()
            .ok_or_else(|| anyhow!("Session branch '{branch}' has no target"))?;

        Ok(SessionMergeContext {
            session_id: session.id,
            session_name: session.name,
            repo_path: session.repository_path,
            worktree_path: session.worktree_path,
            session_branch: session.branch,
            parent_branch: parent_branch.to_string(),
            session_oid,
            parent_oid,
        })
    }

    async fn perform_merge(
        &self,
        context: SessionMergeContext,
        mode: MergeMode,
        commit_message: Option<String>,
    ) -> Result<Result<MergeOutcome>> {
        let mode_copy = mode;
        let context_for_task = context;

        task::spawn_blocking(move || match mode_copy {
            MergeMode::Squash => {
                let message = commit_message
                    .clone()
                    .expect("commit message required for squash merges");
                perform_squash(context_for_task, message)
            }
            MergeMode::Reapply => perform_reapply(context_for_task),
        })
        .await
        .map_err(|e| anyhow!("Merge task panicked: {e}"))
    }
}

fn perform_squash(context: SessionMergeContext, commit_message: String) -> Result<MergeOutcome> {
    info!(
        "{OPERATION_LABEL}: performing squash merge for branch '{branch}' into '{parent}'",
        branch = context.session_branch.as_str(),
        parent = context.parent_branch.as_str()
    );

    if needs_rebase(&context)? {
        if let Err(err) = run_rebase(&context) {
            let _ = abort_rebase(&context);
            return Err(err);
        }
    } else {
        debug!(
            "{OPERATION_LABEL}: skipping rebase for branch '{branch}' because parent '{parent}' is already an ancestor",
            branch = context.session_branch.as_str(),
            parent = context.parent_branch.as_str()
        );
    }

    run_git(
        &context.worktree_path,
        vec![
            OsString::from("reset"),
            OsString::from("--soft"),
            OsString::from(&context.parent_branch),
        ],
    )?;

    run_git(
        &context.worktree_path,
        vec![
            OsString::from("commit"),
            OsString::from("-m"),
            OsString::from(commit_message),
        ],
    )?;

    let repo = Repository::open(&context.repo_path)?;
    let head_oid = resolve_branch_oid(&repo, &context.session_branch)?;
    fast_forward_branch(&repo, &context.parent_branch, head_oid)?;

    Ok(MergeOutcome {
        session_branch: context.session_branch,
        parent_branch: context.parent_branch,
        new_commit: head_oid.to_string(),
        mode: MergeMode::Squash,
    })
}

fn perform_reapply(context: SessionMergeContext) -> Result<MergeOutcome> {
    info!(
        "{OPERATION_LABEL}: performing reapply merge for branch '{branch}' into '{parent}'",
        branch = context.session_branch.as_str(),
        parent = context.parent_branch.as_str()
    );

    if needs_rebase(&context)? {
        if let Err(err) = run_rebase(&context) {
            let _ = abort_rebase(&context);
            return Err(err);
        }
    } else {
        debug!(
            "{OPERATION_LABEL}: skipping rebase for branch '{branch}' because parent '{parent}' is already an ancestor",
            branch = context.session_branch.as_str(),
            parent = context.parent_branch.as_str()
        );
    }

    let repo = Repository::open(&context.repo_path)?;
    let head_oid = resolve_branch_oid(&repo, &context.session_branch)?;
    fast_forward_branch(&repo, &context.parent_branch, head_oid)?;

    Ok(MergeOutcome {
        session_branch: context.session_branch,
        parent_branch: context.parent_branch,
        new_commit: head_oid.to_string(),
        mode: MergeMode::Reapply,
    })
}

fn needs_rebase(context: &SessionMergeContext) -> Result<bool> {
    let repo = Repository::open(&context.repo_path)?;
    let latest_parent_oid = resolve_branch_oid(&repo, &context.parent_branch)?;
    let latest_session_oid = resolve_branch_oid(&repo, &context.session_branch)?;
    let merge_base = repo.merge_base(latest_session_oid, latest_parent_oid)?;
    Ok(merge_base != latest_parent_oid)
}

fn run_rebase(context: &SessionMergeContext) -> Result<()> {
    run_git(
        &context.worktree_path,
        vec![
            OsString::from("rebase"),
            OsString::from(&context.parent_branch),
        ],
    )
}

fn abort_rebase(context: &SessionMergeContext) -> Result<()> {
    run_git(
        &context.worktree_path,
        vec![OsString::from("rebase"), OsString::from("--abort")],
    )
}

pub fn compute_merge_state(
    repo: &Repository,
    session_oid: Oid,
    parent_oid: Oid,
    session_branch: &str,
    parent_branch: &str,
) -> Result<MergeState> {
    if !commits_ahead(repo, session_oid, parent_oid)? {
        return Ok(MergeState {
            has_conflicts: false,
            conflicting_paths: Vec::new(),
            is_up_to_date: true,
        });
    }

    let session_commit = repo.find_commit(session_oid).with_context(|| {
        format!("Failed to find commit {session_oid} for session branch '{session_branch}'")
    })?;
    let parent_commit = repo.find_commit(parent_oid).with_context(|| {
        format!("Failed to find commit {parent_oid} for parent branch '{parent_branch}'")
    })?;

    let mut merge_opts = MergeOptions::new();
    merge_opts.fail_on_conflict(false);

    let index = repo
        .merge_commits(&session_commit, &parent_commit, Some(&merge_opts))
        .with_context(|| {
            format!("Failed to simulate merge between '{session_branch}' and '{parent_branch}'")
        })?;

    let has_conflicts = index.has_conflicts();
    let conflicting_paths = if has_conflicts {
        collect_conflicting_paths(&index)?
    } else {
        Vec::new()
    };

    Ok(MergeState {
        has_conflicts,
        conflicting_paths,
        is_up_to_date: false,
    })
}

fn run_git(current_dir: &Path, args: Vec<OsString>) -> Result<()> {
    debug!(
        "{OPERATION_LABEL}: running git {args:?} in {path}",
        path = current_dir.display()
    );

    let output = std::process::Command::new("git")
        .args(&args)
        .current_dir(current_dir)
        .output()
        .with_context(|| format!("Failed to execute git command: {args:?}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr_output = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    error!(
        "{OPERATION_LABEL}: git command failed {args:?}, status: {status:?}, stderr: {stderr}",
        status = output.status.code(),
        stderr = stderr_output
    );

    let combined = if !stderr_output.is_empty() {
        stderr_output
    } else {
        stdout
    };

    Err(anyhow!(combined))
}

fn commits_ahead(repo: &Repository, session_oid: Oid, parent_oid: Oid) -> Result<bool> {
    if session_oid == parent_oid {
        return Ok(false);
    }

    let mut revwalk = repo.revwalk()?;
    revwalk.push(session_oid)?;
    revwalk.hide(parent_oid).ok();

    Ok(revwalk.next().is_some())
}

fn collect_conflicting_paths(index: &git2::Index) -> Result<Vec<String>> {
    let mut seen = BTreeSet::new();
    let mut conflicts_iter = index
        .conflicts()
        .with_context(|| "Failed to read merge conflicts")?;

    for conflict in conflicts_iter.by_ref().take(CONFLICT_SAMPLE_LIMIT) {
        let conflict = conflict?;
        let path = conflict
            .our
            .as_ref()
            .and_then(index_entry_path)
            .or_else(|| conflict.their.as_ref().and_then(index_entry_path))
            .or_else(|| conflict.ancestor.as_ref().and_then(index_entry_path));

        if let Some(path) = path {
            seen.insert(path);
        }
    }

    Ok(seen.into_iter().collect())
}

fn fast_forward_branch(repo: &Repository, branch: &str, new_oid: Oid) -> Result<()> {
    let reference_name = normalize_branch_ref(branch);
    let mut reference = repo
        .find_reference(&reference_name)
        .with_context(|| format!("Failed to open reference '{reference_name}'"))?;

    let current_oid = reference
        .target()
        .ok_or_else(|| anyhow!("Reference '{reference_name}' has no target"))?;

    if current_oid == new_oid {
        debug!("{OPERATION_LABEL}: branch '{branch}' already at target {new_oid}");
        return Ok(());
    }

    if !repo.graph_descendant_of(new_oid, current_oid)? {
        let new_commit = new_oid;
        let current = current_oid;
        return Err(anyhow!(
            "Cannot fast-forward branch '{branch}' because new commit {new_commit} does not descend from current head {current}"
        ));
    }

    reference.set_target(new_oid, "schaltwerk fast-forward merge")?;

    if let Ok(head) = repo.head() {
        if head.is_branch() && head.shorthand() == Some(branch) {
            debug!("{OPERATION_LABEL}: updating working tree for branch '{branch}'");
            let mut checkout = CheckoutBuilder::new();
            checkout.force();
            repo.checkout_head(Some(&mut checkout))?;
        }
    }

    Ok(())
}

pub fn resolve_branch_oid(repo: &Repository, branch: &str) -> Result<Oid> {
    let reference_name = normalize_branch_ref(branch);
    let reference = repo
        .find_reference(&reference_name)
        .with_context(|| format!("Failed to resolve reference '{reference_name}'"))?;

    reference
        .target()
        .ok_or_else(|| anyhow!("Reference '{reference_name}' has no target"))
}

fn normalize_branch_ref(branch: &str) -> String {
    if branch.starts_with("refs/") {
        branch.to_string()
    } else {
        format!("refs/heads/{branch}")
    }
}

fn find_branch<'repo>(repo: &'repo Repository, name: &str) -> Result<git2::Branch<'repo>> {
    repo.find_branch(name, BranchType::Local)
        .or_else(|_| repo.find_branch(name, BranchType::Remote))
        .with_context(|| format!("Branch '{name}' not found"))
}

fn index_entry_path(entry: &git2::IndexEntry) -> Option<String> {
    std::str::from_utf8(entry.path.as_ref())
        .ok()
        .map(|s| s.trim_end_matches(char::from(0)).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::service::SessionCreationParams;
    use crate::schaltwerk_core::database::Database;
    use tempfile::TempDir;

    fn init_repo(path: &Path) {
        std::fs::create_dir_all(path).unwrap();
        run_git(path, vec![OsString::from("init")]).unwrap();
        run_git(
            path,
            vec![
                OsString::from("config"),
                OsString::from("user.email"),
                OsString::from("test@example.com"),
            ],
        )
        .unwrap();
        run_git(
            path,
            vec![
                OsString::from("config"),
                OsString::from("user.name"),
                OsString::from("Test User"),
            ],
        )
        .unwrap();
        std::fs::write(path.join("README.md"), "initial").unwrap();
        run_git(
            path,
            vec![OsString::from("add"), OsString::from("README.md")],
        )
        .unwrap();
        run_git(
            path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("Initial commit"),
            ],
        )
        .unwrap();
        // Ensure repositories created for tests use the "main" branch so merge code paths align with production defaults.
        run_git(
            path,
            vec![
                OsString::from("branch"),
                OsString::from("-M"),
                OsString::from("main"),
            ],
        )
        .unwrap();
    }

    fn create_session_manager(temp: &TempDir) -> (SessionManager, Database, PathBuf) {
        let repo_path = temp.path().join("repo");
        init_repo(&repo_path);
        let db_path = temp.path().join("db.sqlite");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        (manager, db, repo_path)
    }

    fn write_session_file(path: &Path, name: &str, contents: &str) {
        let file_path = path.join(name);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(file_path, contents).unwrap();
        run_git(path, vec![OsString::from("add"), OsString::from(".")]).unwrap();
        run_git(
            path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("session work"),
            ],
        )
        .unwrap();
    }

    #[tokio::test]
    async fn preview_includes_expected_commands() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "test-session",
            prompt: Some("do work"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();
        write_session_file(&session.worktree_path, "src/lib.rs", "pub fn demo() {}\n");
        manager.mark_session_ready(&session.name, false).unwrap();

        let service = MergeService::new(db, repo_path);
        let preview = service.preview(&session.name).unwrap();

        assert_eq!(preview.parent_branch, "main");
        assert_eq!(preview.session_branch, session.branch);
        assert!(preview
            .squash_commands
            .iter()
            .any(|cmd| cmd.starts_with("git rebase")));
        assert!(preview
            .squash_commands
            .iter()
            .any(|cmd| cmd.starts_with("git reset --soft")));
        assert!(preview
            .reapply_commands
            .iter()
            .any(|cmd| cmd.starts_with("git rebase")));
        assert!(!preview.has_conflicts);
        assert!(!preview.is_up_to_date);
        assert!(preview.conflicting_paths.is_empty());
    }

    #[tokio::test]
    async fn preview_detects_conflicts() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        // Create base file
        std::fs::write(repo_path.join("conflict.txt"), "base\n").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from("conflict.txt")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("add conflict file"),
            ],
        )
        .unwrap();

        let params = SessionCreationParams {
            name: "conflict-session",
            prompt: Some("conflict work"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();

        // Diverging changes: session edits file one way.
        std::fs::write(
            session.worktree_path.join("conflict.txt"),
            "session change\n",
        )
        .unwrap();
        run_git(
            &session.worktree_path,
            vec![OsString::from("add"), OsString::from("conflict.txt")],
        )
        .unwrap();
        run_git(
            &session.worktree_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("session edit"),
            ],
        )
        .unwrap();

        // Parent branch edits same file differently to introduce conflict.
        std::fs::write(repo_path.join("conflict.txt"), "parent change\n").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from("conflict.txt")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("parent edit"),
            ],
        )
        .unwrap();

        manager.mark_session_ready(&session.name, false).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let preview = service.preview(&session.name).unwrap();

        assert!(preview.has_conflicts);
        assert!(!preview.is_up_to_date);
        assert!(!preview.conflicting_paths.is_empty());
    }

    #[tokio::test]
    async fn preview_marks_up_to_date_when_no_commits() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "noop-session",
            prompt: Some("noop"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();
        manager.mark_session_ready(&session.name, false).unwrap();

        // Ensure session branch matches parent by resetting to main head
        run_git(
            &session.worktree_path,
            vec![
                OsString::from("reset"),
                OsString::from("--hard"),
                OsString::from("main"),
            ],
        )
        .unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let preview = service.preview(&session.name).unwrap();

        assert!(preview.is_up_to_date);
        assert!(!preview.has_conflicts);
        assert!(preview.conflicting_paths.is_empty());
    }

    #[tokio::test]
    async fn preview_requires_session_be_ready() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "not-ready",
            prompt: Some("todo"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let err = service
            .preview(&session.name)
            .expect_err("must reject unrready sessions");
        assert!(
            err.to_string().contains("not marked ready"),
            "error should mention readiness requirement"
        );
    }

    #[tokio::test]
    async fn preview_rejects_uncommitted_changes() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "dirty-session",
            prompt: Some("todo"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();
        manager.mark_session_ready(&session.name, false).unwrap();

        // Leave uncommitted file in worktree
        std::fs::write(session.worktree_path.join("dirty.txt"), "pending").unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let err = service
            .preview(&session.name)
            .expect_err("must reject dirty worktree");
        assert!(err.to_string().contains("uncommitted changes"));
    }

    #[tokio::test]
    async fn preview_rejects_missing_worktree() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "missing-worktree",
            prompt: Some("todo"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();
        manager.mark_session_ready(&session.name, false).unwrap();

        std::fs::remove_dir_all(&session.worktree_path).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let err = service
            .preview(&session.name)
            .expect_err("must reject missing worktree");
        assert!(err.to_string().contains("Worktree for session"));
    }

    #[tokio::test]
    async fn squash_merge_updates_parent_branch() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "squash-session",
            prompt: Some("do work"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();
        write_session_file(&session.worktree_path, "src/lib.rs", "pub fn demo() {}\n");
        manager.mark_session_ready(&session.name, false).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let outcome = service
            .merge(
                &session.name,
                MergeMode::Squash,
                Some("Squash merge".into()),
            )
            .await
            .unwrap();

        assert_eq!(outcome.mode, MergeMode::Squash);
        let repo = Repository::open(&session.repository_path).unwrap();
        let parent_oid = resolve_branch_oid(&repo, &outcome.parent_branch).unwrap();
        assert_eq!(parent_oid.to_string(), outcome.new_commit);

        let parent_commit = repo.find_commit(parent_oid).unwrap();
        assert_eq!(parent_commit.summary(), Some("Squash merge"));

        let session_after = manager.get_session(&session.name).unwrap();
        assert!(session_after.ready_to_merge);
        assert_eq!(session_after.session_state, SessionState::Reviewed);
    }

    #[tokio::test]
    async fn squash_merge_preserves_parent_tree_files() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "preserve-parent",
            prompt: Some("do work"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();

        // Add a file on parent branch after the session started.
        std::fs::write(repo_path.join("parent-only.txt"), "parent data\n").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from("parent-only.txt")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("add parent file"),
            ],
        )
        .unwrap();

        // Session introduces its own change while still based on the old parent commit.
        write_session_file(
            &session.worktree_path,
            "src/session.rs",
            "pub fn change() {}\n",
        );
        manager.mark_session_ready(&session.name, false).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let outcome = service
            .merge(
                &session.name,
                MergeMode::Squash,
                Some("Squash merge".into()),
            )
            .await
            .unwrap();

        let repo = Repository::open(&repo_path).unwrap();
        let parent_oid = resolve_branch_oid(&repo, &outcome.parent_branch).unwrap();
        let parent_tree = repo.find_commit(parent_oid).unwrap().tree().unwrap();

        assert!(
            parent_tree.get_name("parent-only.txt").is_some(),
            "parent-only file must remain after squash merge"
        );

        let src_tree = parent_tree
            .get_name("src")
            .and_then(|entry| entry.to_object(&repo).ok())
            .and_then(|obj| obj.into_tree().ok())
            .expect("src tree to exist");
        assert!(
            src_tree.get_name("session.rs").is_some(),
            "session change should be included in merge commit"
        );

        let parent_file_contents =
            std::fs::read_to_string(repo_path.join("parent-only.txt")).unwrap();
        assert_eq!(parent_file_contents, "parent data\n");
    }

    #[tokio::test]
    async fn squash_merge_skips_rebase_when_parent_already_integrated() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "manual-merge",
            prompt: Some("manual merge workflow"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();

        // Session creates its own commit.
        write_session_file(
            &session.worktree_path,
            "src/session.rs",
            "pub fn change() {}\n",
        );

        // Main advances after the session work was created.
        std::fs::write(repo_path.join("main_update.txt"), "main update\n").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from("main_update.txt")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("main update"),
            ],
        )
        .unwrap();

        // Session integrates the latest main via a manual merge, producing a merge commit.
        run_git(
            &session.worktree_path,
            vec![
                OsString::from("merge"),
                OsString::from("--no-edit"),
                OsString::from("main"),
            ],
        )
        .unwrap();

        manager.mark_session_ready(&session.name, false).unwrap();

        let session_after = manager.get_session(&session.name).unwrap();
        let repo = Repository::open(&session_after.repository_path).unwrap();
        let context = SessionMergeContext {
            session_id: session_after.id.clone(),
            session_name: session_after.name.clone(),
            repo_path: session_after.repository_path.clone(),
            worktree_path: session_after.worktree_path.clone(),
            session_branch: session_after.branch.clone(),
            parent_branch: session_after.parent_branch.clone(),
            session_oid: resolve_branch_oid(&repo, &session_after.branch).unwrap(),
            parent_oid: resolve_branch_oid(&repo, &session_after.parent_branch).unwrap(),
        };

        assert!(
            !needs_rebase(&context).unwrap(),
            "rebase should be skipped when main was already merged into the session branch"
        );

        let service = MergeService::new(db.clone(), repo_path.clone());
        let outcome = service
            .merge(
                &session_after.name,
                MergeMode::Squash,
                Some("Squash merge".into()),
            )
            .await
            .unwrap();

        assert_eq!(outcome.mode, MergeMode::Squash);
        let parent_oid = resolve_branch_oid(&repo, &outcome.parent_branch).unwrap();
        assert_eq!(parent_oid.to_string(), outcome.new_commit);

        let final_session = manager.get_session(&session_after.name).unwrap();
        assert!(final_session.ready_to_merge);
        assert_eq!(final_session.session_state, SessionState::Reviewed);
    }

    #[tokio::test]
    async fn reapply_merge_fast_forwards_parent() {
        let temp = TempDir::new().unwrap();
        let (manager, db, _initial_repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "reapply-session",
            prompt: Some("do work"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();
        write_session_file(&session.worktree_path, "src/lib.rs", "pub fn demo() {}\n");
        manager.mark_session_ready(&session.name, false).unwrap();

        // Advance parent branch to force rebase scenario
        let repo_path = temp.path().join("repo");
        std::fs::write(repo_path.join("README.md"), "updated").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from("README.md")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("main update"),
            ],
        )
        .unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let outcome = service
            .merge(&session.name, MergeMode::Reapply, None)
            .await
            .unwrap();

        assert_eq!(outcome.mode, MergeMode::Reapply);
        let repo = Repository::open(&session.repository_path).unwrap();
        let parent_oid = resolve_branch_oid(&repo, &outcome.parent_branch).unwrap();
        assert_eq!(parent_oid.to_string(), outcome.new_commit);

        let session_after = manager.get_session(&session.name).unwrap();
        assert!(session_after.ready_to_merge);
        assert_eq!(session_after.session_state, SessionState::Reviewed);
    }
}

use std::collections::BTreeSet;
#[cfg(test)]
use std::ffi::OsString;
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use git2::{BranchType, ErrorCode, MergeOptions, Oid, Repository, build::CheckoutBuilder};
#[cfg(test)]
use log::error;
use log::{debug, info, warn};

#[cfg(test)]
static RUN_GIT_FORBIDDEN: AtomicBool = AtomicBool::new(false);
use tokio::task;
use tokio::time::timeout;

use crate::domains::git::operations::{
    get_uncommitted_changes_status, has_uncommitted_changes, uncommitted_sample_paths,
};
use crate::domains::git::service as git;
use crate::domains::merge::lock;
use crate::domains::merge::types::{MergeMode, MergeOutcome, MergePreview, MergeState};
use crate::domains::sessions::db_sessions::SessionMethods;
use crate::domains::sessions::entity::SessionState;
use crate::domains::sessions::service::SessionManager;
use crate::infrastructure::database::Database;

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

    pub fn session_manager(&self) -> SessionManager {
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

        self.ensure_parent_branch_clean(&context)?;

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

    fn ensure_parent_branch_clean(&self, context: &SessionMergeContext) -> Result<()> {
        let repo = Repository::open(&context.repo_path)?;
        let head = match repo.head() {
            Ok(head) => head,
            Err(_) => return Ok(()),
        };

        if !head.is_branch() || head.shorthand() != Some(context.parent_branch.as_str()) {
            return Ok(());
        }

        if has_uncommitted_changes(&context.repo_path)? {
            let sample = uncommitted_sample_paths(&context.repo_path, 3)
                .unwrap_or_default()
                .join(", ");
            let hint = if sample.is_empty() {
                String::new()
            } else {
                format!(" Offending paths: {sample}")
            };
            warn!(
                "{OPERATION_LABEL}: parent branch '{branch}' has uncommitted changes in repository '{repo}'. Merge will update refs only without touching the working tree.{hint}",
                branch = context.parent_branch,
                repo = context.repo_path.display(),
                hint = hint
            );
        }

        Ok(())
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

        let resolved_parent = match git::normalize_branch_to_local(&repo, parent_branch) {
            Ok(local) => {
                if local != session.parent_branch {
                    self
                        .db
                        .update_session_parent_branch(&session.id, &local)
                        .inspect_err(|err| {
                            warn!(
                                "{OPERATION_LABEL}: failed to persist normalized parent branch '{local}' for session '{}': {err}",
                                session.name
                            );
                        })
                        .ok();
                }
                local
            }
            Err(err) => {
                if repo.revparse_single(parent_branch).is_ok() {
                    parent_branch.to_string()
                } else {
                    return Err(err.context(format!(
                        "Parent branch '{parent_branch}' is unavailable as a local branch for session '{session_name}'"
                    )));
                }
            }
        };

        let parent_ref = find_branch(&repo, &resolved_parent).with_context(|| {
            format!(
                "Parent branch '{resolved_parent}' not found for session '{session_name}'"
            )
        })?;
        let parent_oid = parent_ref
            .get()
            .target()
            .ok_or_else(|| anyhow!("Parent branch '{resolved_parent}' has no target"))?;

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
            parent_branch: resolved_parent,
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
        rebase_session_branch(&context)?;
    } else {
        debug!(
            "{OPERATION_LABEL}: skipping rebase for branch '{branch}' because parent '{parent}' is already an ancestor",
            branch = context.session_branch.as_str(),
            parent = context.parent_branch.as_str()
        );
    }

    let new_head_oid = create_squash_commit(&context, &commit_message)?;
    let repo = Repository::open(&context.repo_path)?;
    fast_forward_branch(&repo, &context.parent_branch, new_head_oid)?;

    Ok(MergeOutcome {
        session_branch: context.session_branch,
        parent_branch: context.parent_branch,
        new_commit: new_head_oid.to_string(),
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
        rebase_session_branch(&context)?;
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

fn rebase_session_branch(context: &SessionMergeContext) -> Result<()> {
    debug!(
        "{OPERATION_LABEL}: rebasing session branch '{branch}' onto parent '{parent}' via libgit2",
        branch = context.session_branch,
        parent = context.parent_branch
    );

    let repo = Repository::open(&context.worktree_path).with_context(|| {
        format!(
            "Failed to open worktree repository at {}",
            context.worktree_path.display()
        )
    })?;

    let head = repo.head().with_context(|| {
        format!(
            "Failed to resolve HEAD for session branch '{}'",
            context.session_branch
        )
    })?;
    let annotated_branch = repo.reference_to_annotated_commit(&head).with_context(|| {
        format!(
            "Failed to prepare annotated commit for session branch '{}'",
            context.session_branch
        )
    })?;

    let parent_ref_name = normalize_branch_ref(&context.parent_branch);
    let parent_ref = repo.find_reference(&parent_ref_name).with_context(|| {
        format!(
            "Parent reference '{}' missing while rebasing session '{}'",
            parent_ref_name, context.session_name
        )
    })?;
    let annotated_parent = repo
        .reference_to_annotated_commit(&parent_ref)
        .with_context(|| {
            format!(
                "Failed to prepare annotated parent commit '{}' while rebasing session '{}'",
                context.parent_branch, context.session_name
            )
        })?;

    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    checkout.allow_conflicts(true);

    let mut rebase_opts = git2::RebaseOptions::new();
    rebase_opts.checkout_options(checkout);

    let mut rebase = repo
        .rebase(
            Some(&annotated_branch),
            Some(&annotated_parent),
            None,
            Some(&mut rebase_opts),
        )
        .with_context(|| {
            format!(
                "Failed to start rebase for session '{}' onto parent '{}'",
                context.session_name, context.parent_branch
            )
        })?;

    while let Some(op_result) = rebase.next() {
        let op = op_result.with_context(|| {
            format!(
                "Failed advancing rebase operation for session '{}'",
                context.session_name
            )
        })?;

        {
            let index = repo.index()?;
            if index.has_conflicts() {
                let conflicts = collect_conflicting_paths(&index)?;
                let _ = rebase.abort();
                return Err(anyhow!(
                    "Rebase produced conflicts for session '{}': {}",
                    context.session_name,
                    conflicts.join(", ")
                ));
            }
        }

        let original_commit = repo.find_commit(op.id()).with_context(|| {
            format!(
                "Failed to locate original commit '{}' while rebasing session '{}'",
                op.id(),
                context.session_name
            )
        })?;

        let author = original_commit.author().to_owned();
        let committer = original_commit.committer().to_owned();
        let message_owned = original_commit.message().unwrap_or("").to_string();
        let message_opt = if message_owned.is_empty() {
            None
        } else {
            Some(message_owned.as_str())
        };

        if let Err(err) = rebase.commit(Some(&author), &committer, message_opt) {
            if err.code() == ErrorCode::Applied {
                let _ = rebase.abort();
                return Err(anyhow!(
                    "Conflicting change already exists on parent branch '{}' while merging session '{}': {}",
                    context.parent_branch,
                    context.session_name,
                    err.message()
                ));
            }

            let conflicts = repo
                .index()
                .ok()
                .filter(|index| index.has_conflicts())
                .and_then(|index| collect_conflicting_paths(&index).ok());

            let _ = rebase.abort();

            let conflict_hint = conflicts
                .filter(|paths| !paths.is_empty())
                .map(|paths| format!(" Conflicting paths: {}", paths.join(", ")))
                .unwrap_or_default();

            return Err(anyhow!(
                "Rebase failed for session '{}': {}{}",
                context.session_name,
                err,
                conflict_hint
            ));
        }
    }

    match repo.signature() {
        Ok(sig) => rebase.finish(Some(&sig))?,
        Err(_) => rebase.finish(None)?,
    }

    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout))?;

    Ok(())
}

fn create_squash_commit(context: &SessionMergeContext, commit_message: &str) -> Result<Oid> {
    let repo = Repository::open(&context.worktree_path).with_context(|| {
        format!(
            "Failed to open worktree repository at {}",
            context.worktree_path.display()
        )
    })?;

    let parent_oid = resolve_branch_oid(&repo, &context.parent_branch)?;
    let parent_commit = repo.find_commit(parent_oid).with_context(|| {
        format!(
            "Failed to locate parent commit '{}' for squash merge",
            context.parent_branch
        )
    })?;

    repo.reset(parent_commit.as_object(), git2::ResetType::Soft, None)
        .with_context(|| {
            format!(
                "Failed to perform soft reset to parent '{}' before squash merge",
                context.parent_branch
            )
        })?;

    let mut index = repo.index()?;
    if index.has_conflicts() {
        let conflicts = collect_conflicting_paths(&index)?;
        return Err(anyhow!(
            "Cannot create squash commit for session '{}': unresolved conflicts {}",
            context.session_name,
            conflicts.join(", ")
        ));
    }

    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let signature = repo
        .signature()
        .with_context(|| "Git signature is required to create squash merge commit".to_string())?;

    let reference_name = normalize_branch_ref(&context.session_branch);
    let new_commit_oid = repo
        .commit(
            Some(&reference_name),
            &signature,
            &signature,
            commit_message,
            &tree,
            &[&parent_commit],
        )
        .with_context(|| {
            format!(
                "Failed to create squash commit for session '{}' targeting parent '{}'",
                context.session_name, context.parent_branch
            )
        })?;

    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout))?;

    Ok(new_commit_oid)
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

    let conflicting_paths = if index.has_conflicts() {
        collect_conflicting_paths(&index)?
    } else {
        Vec::new()
    };

    let has_conflicts = !conflicting_paths.is_empty();

    Ok(MergeState {
        has_conflicts,
        conflicting_paths,
        is_up_to_date: false,
    })
}

#[cfg(test)]
fn run_git(current_dir: &Path, args: Vec<OsString>) -> Result<()> {
    if RUN_GIT_FORBIDDEN.load(Ordering::SeqCst) {
        panic!(
            "run_git invoked while forbidden: command=git {:?}, cwd={}",
            args,
            current_dir.display()
        );
    }

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

    for conflict in conflicts_iter.by_ref() {
        let conflict = conflict?;
        let path = conflict
            .our
            .as_ref()
            .and_then(index_entry_path)
            .or_else(|| conflict.their.as_ref().and_then(index_entry_path))
            .or_else(|| conflict.ancestor.as_ref().and_then(index_entry_path));

        if let Some(path) = path {
            if path == ".schaltwerk" || path.starts_with(".schaltwerk/") {
                continue;
            }

            if seen.len() < CONFLICT_SAMPLE_LIMIT {
                seen.insert(path);
            }

            if seen.len() == CONFLICT_SAMPLE_LIMIT {
                break;
            }
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

    let pre_update_state = repo.workdir().map(get_uncommitted_changes_status);

    reference.set_target(new_oid, "schaltwerk fast-forward merge")?;

    let mut should_update_worktree = false;
    let mut skip_reason: Option<String> = None;

    if let Ok(head) = repo.head()
        && head.is_branch()
        && head.shorthand() == Some(branch)
    {
        if let Some(workdir) = repo.workdir() {
            let workdir_path = workdir.to_path_buf();
            match pre_update_state {
                Some(Ok(status)) => {
                    if status.has_tracked_changes {
                        skip_reason = Some(format!(
                            "working tree '{}' has tracked changes",
                            workdir_path.display()
                        ));
                    } else {
                        should_update_worktree = true;
                        if status.has_untracked_changes {
                            debug!(
                                "{OPERATION_LABEL}: updating working tree for branch '{branch}' while preserving untracked files"
                            );
                        }
                    }
                }
                Some(Err(err)) => {
                    skip_reason = Some(format!(
                        "unable to inspect working tree '{}': {err}",
                        workdir_path.display()
                    ));
                }
                None => {
                    should_update_worktree = true;
                }
            }
        } else {
            should_update_worktree = true;
        }
    }

    if should_update_worktree {
        debug!("{OPERATION_LABEL}: updating working tree for branch '{branch}'");
        let mut checkout = CheckoutBuilder::new();
        checkout.force();
        repo.checkout_head(Some(&mut checkout))?;
    } else if let Some(reason) = skip_reason {
        info!(
            "{OPERATION_LABEL}: skipping working tree checkout for branch '{branch}' because {reason}"
        );
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
    use crate::infrastructure::database::Database;
    use serial_test::serial;
    use std::sync::atomic::Ordering;
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

    struct RunGitBlocker;

    impl RunGitBlocker {
        fn new() -> Self {
            RUN_GIT_FORBIDDEN.store(true, Ordering::SeqCst);
            RunGitBlocker
        }
    }

    impl Drop for RunGitBlocker {
        fn drop(&mut self) {
            RUN_GIT_FORBIDDEN.store(false, Ordering::SeqCst);
        }
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
        assert!(
            preview
                .squash_commands
                .iter()
                .any(|cmd| cmd.starts_with("git rebase"))
        );
        assert!(
            preview
                .squash_commands
                .iter()
                .any(|cmd| cmd.starts_with("git reset --soft"))
        );
        assert!(
            preview
                .reapply_commands
                .iter()
                .any(|cmd| cmd.starts_with("git rebase"))
        );
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
    async fn preview_handles_remote_parent_branch_records_with_local_conflicts() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let remote_dir = temp.path().join("remote.git");
        std::fs::create_dir_all(&remote_dir).unwrap();
        run_git(
            &remote_dir,
            vec![OsString::from("init"), OsString::from("--bare")],
        )
        .unwrap();

        run_git(
            &repo_path,
            vec![
                OsString::from("remote"),
                OsString::from("add"),
                OsString::from("origin"),
                remote_dir.as_os_str().into(),
            ],
        )
        .unwrap();

        run_git(
            &repo_path,
            vec![
                OsString::from("push"),
                OsString::from("--set-upstream"),
                OsString::from("origin"),
                OsString::from("main"),
            ],
        )
        .unwrap();

        run_git(
            &repo_path,
            vec![OsString::from("fetch"), OsString::from("origin")],
        )
        .unwrap();

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
                OsString::from("seed conflict file"),
            ],
        )
        .unwrap();

        let params = SessionCreationParams {
            name: "remote-parent",
            prompt: Some("conflict work"),
            base_branch: Some("origin/main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();

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

        std::fs::write(repo_path.join("conflict.txt"), "main change\n").unwrap();
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
                OsString::from("main edit"),
            ],
        )
        .unwrap();

        manager.mark_session_ready(&session.name, false).unwrap();

        db.update_session_parent_branch(&session.id, "origin/main")
            .unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let preview = service.preview(&session.name).unwrap();

        assert!(preview.has_conflicts);
        assert_eq!(preview.parent_branch, "main");

        let refreshed = manager.get_session(&session.name).unwrap();
        assert_eq!(refreshed.parent_branch, "main");
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

    #[tokio::test]
    #[serial]
    async fn merge_reapply_skips_shelling_out_to_git() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "reapply-no-git",
            prompt: Some("reapply"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();
        write_session_file(
            &session.worktree_path,
            "src/lib.rs",
            "pub fn feature() -> i32 { 1 }\n",
        );

        std::fs::write(repo_path.join("base.txt"), "parent diverges\n").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from("base.txt")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("parent diverges"),
            ],
        )
        .unwrap();

        manager.mark_session_ready(&session.name, false).unwrap();

        let repo_before = Repository::open(&repo_path).unwrap();
        let parent_before_oid = resolve_branch_oid(&repo_before, "main").unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let blocker = RunGitBlocker::new();
        let outcome = service
            .merge(&session.name, MergeMode::Reapply, None)
            .await
            .expect("reapply merge should succeed without spawning git");
        drop(blocker);

        assert_eq!(outcome.mode, MergeMode::Reapply);

        let repo_after = Repository::open(&repo_path).unwrap();
        let parent_head = resolve_branch_oid(&repo_after, "main").unwrap();
        let session_head = resolve_branch_oid(&repo_after, &session.branch).unwrap();
        assert_eq!(parent_head, session_head);

        let new_commit = repo_after.find_commit(parent_head).unwrap();
        assert_eq!(new_commit.parent_id(0).unwrap(), parent_before_oid);
        assert_eq!(new_commit.message().unwrap().trim(), "session work");
    }

    #[tokio::test]
    #[serial]
    async fn merge_squash_skips_shelling_out_to_git() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "squash-no-git",
            prompt: Some("squash"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();
        write_session_file(&session.worktree_path, "src/lib.rs", "pub fn alpha() {}\n");
        write_session_file(
            &session.worktree_path,
            "src/lib.rs",
            "pub fn alpha() {}\npub fn beta() {}\n",
        );

        std::fs::write(repo_path.join("base.txt"), "parent divergence\n").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from("base.txt")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("parent diverges"),
            ],
        )
        .unwrap();

        manager.mark_session_ready(&session.name, false).unwrap();

        let repo_before = Repository::open(&repo_path).unwrap();
        let parent_before_oid = resolve_branch_oid(&repo_before, "main").unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let blocker = RunGitBlocker::new();
        let commit_message = "Squashed session work";
        let outcome = service
            .merge(
                &session.name,
                MergeMode::Squash,
                Some(commit_message.to_string()),
            )
            .await
            .expect("squash merge should succeed without spawning git");
        drop(blocker);

        assert_eq!(outcome.mode, MergeMode::Squash);
        assert_eq!(outcome.parent_branch, "main");

        let repo_after = Repository::open(&repo_path).unwrap();
        let parent_head = resolve_branch_oid(&repo_after, "main").unwrap();
        assert_eq!(parent_head.to_string(), outcome.new_commit);

        let new_commit = repo_after.find_commit(parent_head).unwrap();
        assert_eq!(new_commit.parent_id(0).unwrap(), parent_before_oid);
        assert_eq!(new_commit.message().unwrap().trim(), commit_message);

        let session_head = resolve_branch_oid(&repo_after, &session.branch).unwrap();
        assert_eq!(session_head, parent_head);
    }

    #[tokio::test]
    async fn merge_reapply_preserves_session_on_conflict() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "reapply-conflict",
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
        write_session_file(&session.worktree_path, "conflict.txt", "session change\n");
        manager.mark_session_ready(&session.name, false).unwrap();

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
                OsString::from("parent conflicting change"),
            ],
        )
        .unwrap();

        let repo_before = Repository::open(&repo_path).unwrap();
        let session_head_before = resolve_branch_oid(&repo_before, &session.branch).unwrap();
        let parent_head_before = resolve_branch_oid(&repo_before, &session.parent_branch).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let err = service
            .merge(&session.name, MergeMode::Reapply, None)
            .await
            .expect_err("merge should surface rebase conflict and abort");
        assert!(
            err.to_string().to_lowercase().contains("conflict"),
            "error message should mention conflict, got: {err}"
        );

        let session_after = manager
            .get_session(&session.name)
            .expect("session should remain in database after conflict");
        assert!(session_after.worktree_path.exists());
        assert!(session_after.worktree_path.join("conflict.txt").exists());

        let repo_after = Repository::open(&repo_path).unwrap();
        let session_head_after = resolve_branch_oid(&repo_after, &session.branch).unwrap();
        let parent_head_after = resolve_branch_oid(&repo_after, &session.parent_branch).unwrap();

        assert_eq!(
            session_head_after, session_head_before,
            "session branch should remain on original commit when merge fails"
        );
        assert_eq!(
            parent_head_after, parent_head_before,
            "parent branch must be unchanged when merge fails"
        );
    }

    #[tokio::test]
    async fn merge_squash_preserves_session_on_conflict() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "squash-conflict",
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
        write_session_file(&session.worktree_path, "conflict.txt", "session change\n");
        manager.mark_session_ready(&session.name, false).unwrap();

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
                OsString::from("parent conflicting change"),
            ],
        )
        .unwrap();

        let repo_before = Repository::open(&repo_path).unwrap();
        let session_head_before = resolve_branch_oid(&repo_before, &session.branch).unwrap();
        let parent_head_before = resolve_branch_oid(&repo_before, &session.parent_branch).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let err = service
            .merge(
                &session.name,
                MergeMode::Squash,
                Some("should fail due to conflict".into()),
            )
            .await
            .expect_err("squash merge should fail when conflicts exist");
        assert!(
            err.to_string().to_lowercase().contains("conflict"),
            "error message should mention conflict, got: {err}"
        );

        let session_after = manager
            .get_session(&session.name)
            .expect("session should remain after failed squash merge");
        assert!(session_after.worktree_path.exists());
        assert!(session_after.worktree_path.join("conflict.txt").exists());

        let repo_after = Repository::open(&repo_path).unwrap();
        let session_head_after = resolve_branch_oid(&repo_after, &session.branch).unwrap();
        let parent_head_after = resolve_branch_oid(&repo_after, &session.parent_branch).unwrap();

        assert_eq!(
            session_head_after, session_head_before,
            "session branch should remain untouched when squash merge fails"
        );
        assert_eq!(
            parent_head_after, parent_head_before,
            "parent branch must remain unchanged when squash merge fails"
        );
    }

    #[tokio::test]
    async fn merge_reapply_reports_already_applied_patch_as_conflict() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "duplicate-change",
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
        write_session_file(
            &session.worktree_path,
            "src/lib.rs",
            "pub fn change() -> i32 { 1 }\n",
        );
        manager.mark_session_ready(&session.name, false).unwrap();

        // Apply the exact same change to main, so the session commit becomes redundant.
        std::fs::create_dir_all(repo_path.join("src")).unwrap();
        std::fs::write(
            repo_path.join("src/lib.rs"),
            "pub fn change() -> i32 { 1 }\n",
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from("src/lib.rs")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("apply session change on main"),
            ],
        )
        .unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let err = service
            .merge(&session.name, MergeMode::Reapply, None)
            .await
            .expect_err("merge should fail because the patch already exists on main");
        assert!(
            err.to_string().to_lowercase().contains("conflict"),
            "error should be treated as a conflict, message: {err}"
        );

        let session_after = manager
            .get_session(&session.name)
            .expect("session should remain after duplicate change rejection");
        assert!(session_after.worktree_path.exists());
    }

    #[tokio::test]
    async fn merge_reapply_handles_dirty_parent_branch_without_touching_worktree() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "dirty-parent-reapply",
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
        write_session_file(&session.worktree_path, "src/lib.rs", "pub fn change() {}\n");
        manager.mark_session_ready(&session.name, false).unwrap();

        std::fs::write(repo_path.join("dirty.txt"), "uncommitted change").unwrap();

        let repo_before = Repository::open(&repo_path).unwrap();
        let session_head_before = resolve_branch_oid(&repo_before, &session.branch).unwrap();
        let parent_head_before = resolve_branch_oid(&repo_before, &session.parent_branch).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let outcome = service
            .merge(&session.name, MergeMode::Reapply, None)
            .await
            .expect("merge should succeed even when parent branch has uncommitted changes");
        assert_eq!(outcome.mode, MergeMode::Reapply);
        assert_eq!(outcome.parent_branch, session.parent_branch);

        let session_after = manager
            .get_session(&session.name)
            .expect("session should remain after merge");
        assert!(session_after.worktree_path.exists());

        let repo_after = Repository::open(&repo_path).unwrap();
        let session_head_after = resolve_branch_oid(&repo_after, &session.branch).unwrap();
        let parent_head_after = resolve_branch_oid(&repo_after, &session.parent_branch).unwrap();

        assert_eq!(session_head_after, session_head_before);
        assert_ne!(parent_head_after, parent_head_before);
        assert_eq!(parent_head_after, session_head_after);

        let merged_file = repo_path.join("src/lib.rs");
        assert_eq!(
            std::fs::read_to_string(&merged_file).unwrap(),
            "pub fn change() {}\n"
        );

        let status_output = std::process::Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        let status_stdout = String::from_utf8(status_output.stdout).unwrap();
        assert!(
            status_stdout
                .lines()
                .any(|line| line.trim() == "?? dirty.txt"),
            "expected dirty.txt to remain untracked, status output:\n{status_stdout}"
        );
        assert!(
            !status_stdout.contains(" D "),
            "expected no tracked deletions, status output:\n{status_stdout}"
        );

        assert!(has_uncommitted_changes(&repo_path).unwrap());
        let dirty_path = repo_path.join("dirty.txt");
        assert!(
            dirty_path.exists(),
            "dirty.txt should remain in the worktree"
        );
        assert_eq!(
            std::fs::read_to_string(&dirty_path).unwrap(),
            "uncommitted change"
        );
    }

    #[tokio::test]
    async fn merge_squash_handles_dirty_parent_branch_without_touching_worktree() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let params = SessionCreationParams {
            name: "dirty-parent-squash",
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
        write_session_file(&session.worktree_path, "src/lib.rs", "pub fn change() {}\n");
        manager.mark_session_ready(&session.name, false).unwrap();

        std::fs::write(repo_path.join("dirty.txt"), "uncommitted change").unwrap();

        let repo_before = Repository::open(&repo_path).unwrap();
        let session_head_before = resolve_branch_oid(&repo_before, &session.branch).unwrap();
        let parent_head_before = resolve_branch_oid(&repo_before, &session.parent_branch).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let outcome = service
            .merge(
                &session.name,
                MergeMode::Squash,
                Some("squash message".into()),
            )
            .await
            .expect("squash merge should succeed even when parent branch has uncommitted changes");
        assert_eq!(outcome.mode, MergeMode::Squash);
        assert_eq!(outcome.parent_branch, session.parent_branch);

        let session_after = manager
            .get_session(&session.name)
            .expect("session should remain after merge");
        assert!(session_after.worktree_path.exists());

        let repo_after = Repository::open(&repo_path).unwrap();
        let session_head_after = resolve_branch_oid(&repo_after, &session.branch).unwrap();
        let parent_head_after = resolve_branch_oid(&repo_after, &session.parent_branch).unwrap();

        assert_ne!(session_head_after, session_head_before);
        assert_ne!(parent_head_after, parent_head_before);
        assert_eq!(session_head_after.to_string(), outcome.new_commit);
        assert_eq!(outcome.new_commit, parent_head_after.to_string());

        let merged_file = repo_path.join("src/lib.rs");
        assert_eq!(
            std::fs::read_to_string(&merged_file).unwrap(),
            "pub fn change() {}\n"
        );

        let status_output = std::process::Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        let status_stdout = String::from_utf8(status_output.stdout).unwrap();
        assert!(
            status_stdout
                .lines()
                .any(|line| line.trim() == "?? dirty.txt"),
            "expected dirty.txt to remain untracked, status output:\n{status_stdout}"
        );
        assert!(
            !status_stdout.contains(" D "),
            "expected no tracked deletions, status output:\n{status_stdout}"
        );

        assert!(has_uncommitted_changes(&repo_path).unwrap());
        let dirty_path = repo_path.join("dirty.txt");
        assert!(
            dirty_path.exists(),
            "dirty.txt should remain in the worktree"
        );
        assert_eq!(
            std::fs::read_to_string(&dirty_path).unwrap(),
            "uncommitted change"
        );
    }

    #[tokio::test]
    async fn preview_ignores_schaltwerk_internal_conflicts() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        std::fs::create_dir_all(repo_path.join(".schaltwerk")).unwrap();
        std::fs::write(repo_path.join(".schaltwerk/config.json"), "{}").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from(".schaltwerk")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("add schaltwerk config"),
            ],
        )
        .unwrap();

        let params = SessionCreationParams {
            name: "internal-conflict",
            prompt: Some("internal conflict test"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();

        std::fs::write(
            session.worktree_path.join(".schaltwerk/config.json"),
            r#"{"session": "change"}"#,
        )
        .unwrap();
        run_git(
            &session.worktree_path,
            vec![OsString::from("add"), OsString::from(".schaltwerk")],
        )
        .unwrap();
        run_git(
            &session.worktree_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("session schaltwerk change"),
            ],
        )
        .unwrap();

        std::fs::write(
            repo_path.join(".schaltwerk/config.json"),
            r#"{"parent": "change"}"#,
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from(".schaltwerk")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("parent schaltwerk change"),
            ],
        )
        .unwrap();

        manager.mark_session_ready(&session.name, false).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let preview = service.preview(&session.name).unwrap();

        assert!(
            !preview.has_conflicts,
            ".schaltwerk conflicts should be ignored"
        );
        assert!(
            preview.conflicting_paths.is_empty(),
            "conflicting_paths should not include .schaltwerk files"
        );
    }

    #[tokio::test]
    async fn preview_reports_real_conflicts_even_with_many_internal_entries() {
        let temp = TempDir::new().unwrap();
        let (manager, db, repo_path) = create_session_manager(&temp);

        let internal_files: Vec<String> = (0..7)
            .map(|idx| format!(".schaltwerk/internal-{idx}.json"))
            .collect();

        std::fs::create_dir_all(repo_path.join(".schaltwerk")).unwrap();
        for file in &internal_files {
            std::fs::write(repo_path.join(file), "base").unwrap();
        }
        std::fs::write(repo_path.join("conflict.txt"), "base-conflict").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from(".")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("seed internal files"),
            ],
        )
        .unwrap();

        let params = SessionCreationParams {
            name: "noise-conflict",
            prompt: Some("noise"),
            base_branch: Some("main"),
            custom_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: None,
            skip_permissions: None,
        };

        let session = manager.create_session_with_agent(params).unwrap();

        for file in &internal_files {
            std::fs::write(session.worktree_path.join(file), "session").unwrap();
        }
        std::fs::write(
            session.worktree_path.join("conflict.txt"),
            "session-change",
        )
        .unwrap();
        run_git(
            &session.worktree_path,
            vec![OsString::from("add"), OsString::from(".")],
        )
        .unwrap();
        run_git(
            &session.worktree_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("session edits"),
            ],
        )
        .unwrap();

        for file in &internal_files {
            std::fs::write(repo_path.join(file), "parent").unwrap();
        }
        std::fs::write(repo_path.join("conflict.txt"), "parent-change").unwrap();
        run_git(
            &repo_path,
            vec![OsString::from("add"), OsString::from(".")],
        )
        .unwrap();
        run_git(
            &repo_path,
            vec![
                OsString::from("commit"),
                OsString::from("-m"),
                OsString::from("parent edits"),
            ],
        )
        .unwrap();

        manager.mark_session_ready(&session.name, false).unwrap();

        let service = MergeService::new(db.clone(), repo_path.clone());
        let preview = service.preview(&session.name).unwrap();

        assert!(preview.has_conflicts);
        assert!(
            preview
                .conflicting_paths
                .iter()
                .any(|path| path == "conflict.txt"),
            "conflict.txt should surface despite internal noise"
        );
    }
}

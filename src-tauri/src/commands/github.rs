use crate::get_project_manager;
use log::{error, info, warn};
use schaltwerk::domains::git::service::rename_branch;
use schaltwerk::infrastructure::events::{SchaltEvent, emit_event};
use schaltwerk::project_manager::ProjectManager;
use schaltwerk::schaltwerk_core::db_project_config::{ProjectConfigMethods, ProjectGithubConfig};
use schaltwerk::shared::session_metadata_gateway::SessionMetadataGateway;
use schaltwerk::services::{
    CommandRunner, CreatePrOptions, CreateSessionPrOptions, GitHubCli, GitHubCliError,
    GitHubIssueComment, GitHubIssueDetails, GitHubIssueLabel, GitHubIssueSummary,
    GitHubPrDetails, GitHubPrReview, GitHubPrReviewComment, GitHubPrSummary, GitHubStatusCheck,
    MergeMode, PrCommitMode, PrContent, sanitize_branch_name,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryPayload {
    pub name_with_owner: String,
    pub default_branch: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubStatusPayload {
    pub installed: bool,
    pub authenticated: bool,
    pub user_login: Option<String>,
    pub repository: Option<GitHubRepositoryPayload>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrPayload {
    pub branch: String,
    pub url: String,
}

const ISSUE_SEARCH_DEFAULT_LIMIT: usize = 50;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueLabelPayload {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueSummaryPayload {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<String>,
    pub labels: Vec<GitHubIssueLabelPayload>,
    pub url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueCommentPayload {
    pub author: Option<String>,
    pub created_at: String,
    pub body: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueDetailsPayload {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub body: String,
    pub labels: Vec<GitHubIssueLabelPayload>,
    pub comments: Vec<GitHubIssueCommentPayload>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrSummaryPayload {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<String>,
    pub labels: Vec<GitHubIssueLabelPayload>,
    pub url: String,
    pub head_ref_name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrReviewPayload {
    pub author: Option<String>,
    pub state: String,
    pub submitted_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrDetailsPayload {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub body: String,
    pub labels: Vec<GitHubIssueLabelPayload>,
    pub comments: Vec<GitHubIssueCommentPayload>,
    pub head_ref_name: String,
    pub review_decision: Option<String>,
    pub status_check_state: Option<String>,
    pub latest_reviews: Vec<GitHubPrReviewPayload>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrReviewCommentPayload {
    pub id: u64,
    pub path: String,
    pub line: Option<u64>,
    pub body: String,
    pub author: Option<String>,
    pub created_at: String,
    pub html_url: String,
    pub in_reply_to_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReviewedPrArgs {
    pub session_slug: String,
    pub worktree_path: String,
    pub default_branch: Option<String>,
    pub commit_message: Option<String>,
    pub repository: Option<String>,
    pub pr_title: Option<String>,
    pub pr_body: Option<String>,
    pub target_branch: Option<String>,
    pub custom_branch_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionPrArgs {
    pub session_name: String,
    pub pr_title: String,
    pub pr_body: Option<String>,
    pub base_branch: Option<String>,
    pub pr_branch_name: Option<String>,
    pub commit_message: Option<String>,
    pub repository: Option<String>,
    pub mode: MergeMode,
    #[serde(default)]
    pub cancel_after_pr: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrPreviewPayload {
    pub session_name: String,
    pub session_branch: String,
    pub parent_branch: String,
    pub default_title: String,
    pub default_body: String,
    pub commit_count: usize,
    pub commit_summaries: Vec<String>,
    pub default_branch: String,
    pub worktree_path: String,
    pub has_uncommitted_changes: bool,
    pub branch_pushed: bool,
    pub branch_conflict_warning: Option<String>,
}

#[tauri::command]
pub async fn github_get_status() -> Result<GitHubStatusPayload, String> {
    build_status().await
}

#[tauri::command]
pub async fn github_authenticate(_app: AppHandle) -> Result<GitHubStatusPayload, String> {
    let cli = GitHubCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    info!("GitHub CLI authentication requires manual setup");
    match cli.authenticate() {
        Err(err) => {
            error!("GitHub authentication requires user action: {err}");
            Err(format_cli_error(err))
        }
        Ok(()) => {
            info!("GitHub CLI reported successful authentication");
            build_status().await
        }
    }
}

#[tauri::command]
pub async fn github_connect_project(app: AppHandle) -> Result<GitHubRepositoryPayload, String> {
    let cli = GitHubCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;
    let project_path = project.path.clone();

    info!(
        "Fetching repository metadata for project {}",
        project_path.display()
    );
    let repo_info = cli.view_repository(&project_path).map_err(|err| {
        error!("Failed to read repository via GitHub CLI: {err}");
        format_cli_error(err)
    })?;

    {
        let core = project.schaltwerk_core.write().await;
        let db = core.database();
        let config = ProjectGithubConfig {
            repository: repo_info.name_with_owner.clone(),
            default_branch: repo_info.default_branch.clone(),
        };
        db.set_project_github_config(&project_path, &config)
            .map_err(|e| format!("Failed to store GitHub repository config: {e}"))?;
    }

    let payload = GitHubRepositoryPayload {
        name_with_owner: repo_info.name_with_owner,
        default_branch: repo_info.default_branch,
    };

    let status = build_status().await?;
    emit_status(&app, &status)?;
    Ok(payload)
}

#[tauri::command]
pub async fn github_create_reviewed_pr(
    _app: AppHandle,
    args: CreateReviewedPrArgs,
) -> Result<GitHubPrPayload, String> {
    let cli = GitHubCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;
    let project_path = project.path.clone();

    let repository_config = {
        let core = project.schaltwerk_core.read().await;
        let db = core.database();
        db.get_project_github_config(&project.path)
            .map_err(|e| format!("Failed to load GitHub project config: {e}"))?
            .map(|cfg| GitHubRepositoryPayload {
                name_with_owner: cfg.repository,
                default_branch: cfg.default_branch,
            })
    };

    let worktree_path = PathBuf::from(&args.worktree_path);
    if !worktree_path.exists() {
        return Err(format!(
            "Worktree path does not exist: {}",
            worktree_path.display()
        ));
    }

    let default_branch = args
        .default_branch
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            repository_config
                .as_ref()
                .map(|cfg| cfg.default_branch.clone())
        })
        .unwrap_or_else(|| "main".to_string());

    let repository = args
        .repository
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            repository_config
                .as_ref()
                .map(|cfg| cfg.name_with_owner.clone())
        });

    info!(
        "Creating GitHub PR for session '{}' on branch '{}'",
        args.session_slug, default_branch
    );
    let content = match args.pr_title.as_deref().filter(|t| !t.trim().is_empty()) {
        Some(title) => PrContent::Explicit {
            title,
            body: args.pr_body.as_deref().unwrap_or(""),
        },
        None => PrContent::Fill,
    };

    let pr_result = cli
        .create_pr_from_worktree(CreatePrOptions {
            repo_path: &project_path,
            worktree_path: &worktree_path,
            session_slug: &args.session_slug,
            default_branch: &default_branch,
            commit_message: args.commit_message.as_deref(),
            repository: repository.as_deref(),
            content,
            target_branch: args.target_branch.as_deref(),
            custom_branch_name: args.custom_branch_name.as_deref(),
        })
        .map_err(|err| {
            error!("GitHub PR creation failed: {err}");
            format_cli_error(err)
        })?;

    Ok(GitHubPrPayload {
        branch: pr_result.branch,
        url: pr_result.url,
    })
}

#[tauri::command]
pub async fn github_create_session_pr(
    app: AppHandle,
    args: CreateSessionPrArgs,
) -> Result<GitHubPrPayload, String> {
    github_create_session_pr_impl(app, args).await
}

pub async fn github_create_session_pr_impl(
    app: AppHandle,
    args: CreateSessionPrArgs,
) -> Result<GitHubPrPayload, String> {
    use crate::commands::schaltwerk_core::schaltwerk_core_cancel_session;

    let cli = GitHubCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;
    let project_path = project.path.clone();

    let repository_config = {
        let core = project.schaltwerk_core.read().await;
        let db = core.database();
        db.get_project_github_config(&project.path)
            .map_err(|e| format!("Failed to load GitHub project config: {e}"))?
            .map(|cfg| GitHubRepositoryPayload {
                name_with_owner: cfg.repository,
                default_branch: cfg.default_branch,
            })
    };

    let (session_worktree, session_branch, parent_branch, session_state) = {
        let core = project.schaltwerk_core.read().await;
        let session = core
            .session_manager()
            .get_session(&args.session_name)
            .map_err(|e| format!("Session not found: {e}"))?;
        (
            session.worktree_path.clone(),
            session.branch.clone(),
            session.parent_branch.clone(),
            session.session_state,
        )
    };

    if session_state == schaltwerk::domains::sessions::SessionState::Spec {
        return Err("Cannot create PR for a spec session. Start the session first.".to_string());
    }

    let base_branch = args
        .base_branch
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            let trimmed = parent_branch.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| repository_config.as_ref().map(|cfg| cfg.default_branch.clone()))
        .unwrap_or_else(|| "main".to_string());

    let repository = args
        .repository
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| repository_config.as_ref().map(|cfg| cfg.name_with_owner.clone()));

    let pr_branch_name = args
        .pr_branch_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(sanitize_branch_name)
        .unwrap_or_else(|| session_branch.clone());

    info!(
        "Creating PR for session '{}' (branch='{}', base='{}', head='{}')",
        args.session_name, session_branch, base_branch, pr_branch_name
    );

    let pr_mode = match args.mode {
        MergeMode::Squash => PrCommitMode::Squash,
        MergeMode::Reapply => PrCommitMode::Reapply,
    };

    let pr_result = cli
        .create_session_pr(CreateSessionPrOptions {
            repo_path: &project_path,
            session_worktree_path: &session_worktree,
            session_slug: &args.session_name,
            session_branch: &session_branch,
            base_branch: &base_branch,
            pr_branch_name: &pr_branch_name,
            content: PrContent::Explicit {
                title: &args.pr_title,
                body: args.pr_body.as_deref().unwrap_or(""),
            },
            commit_message: args.commit_message.as_deref(),
            repository: repository.as_deref(),
            mode: pr_mode,
        })
        .map_err(|err| {
            error!("GitHub PR creation failed: {err}");
            format_cli_error(err)
        })?;

    // If a custom branch name was used, rename the local branch and update the database
    if pr_result.branch != session_branch {
        info!(
            "PR branch '{}' differs from session branch '{}', updating session",
            pr_result.branch, session_branch
        );

        // Rename the local git branch to match the PR branch
        if let Err(e) = rename_branch(&session_worktree, &session_branch, &pr_result.branch) {
            warn!(
                "Failed to rename local branch from '{}' to '{}': {e}",
                session_branch, pr_result.branch
            );
        }

        // Update the session's branch in the database
        {
            let core = project.schaltwerk_core.read().await;
            let session = core
                .session_manager()
                .get_session(&args.session_name)
                .map_err(|e| format!("Failed to get session for branch update: {e}"))?;

            if let Err(e) =
                SessionMetadataGateway::new(core.database()).update_session_branch(&session.id, &pr_result.branch)
            {
                warn!(
                    "Failed to update session branch in database to '{}': {e}",
                    pr_result.branch
                );
            }
        }

        // Emit refresh event so UI updates
        emit_event(&app, SchaltEvent::SessionsRefreshed, &project_path)
            .map_err(|e| format!("Failed to emit sessions refresh: {e}"))?;
    }

    if args.cancel_after_pr
        && let Err(err) =
            schaltwerk_core_cancel_session(app.clone(), args.session_name.clone()).await
    {
        error!(
            "PR created but auto-cancel failed for session '{}': {err}",
            args.session_name
        );
    }

    Ok(GitHubPrPayload {
        branch: pr_result.branch,
        url: pr_result.url,
    })
}

#[tauri::command]
pub async fn github_search_issues(
    _app: AppHandle,
    query: Option<String>,
) -> Result<Vec<GitHubIssueSummaryPayload>, String> {
    let manager = get_project_manager().await;
    let cli = GitHubCli::new();
    github_search_issues_impl(
        Arc::clone(&manager),
        &cli,
        query,
        ISSUE_SEARCH_DEFAULT_LIMIT,
    )
    .await
}

#[tauri::command]
pub async fn github_get_issue_details(
    _app: AppHandle,
    number: u64,
) -> Result<GitHubIssueDetailsPayload, String> {
    let manager = get_project_manager().await;
    let cli = GitHubCli::new();
    github_get_issue_details_impl(Arc::clone(&manager), &cli, number).await
}

#[tauri::command]
pub async fn github_search_prs(
    _app: AppHandle,
    query: Option<String>,
) -> Result<Vec<GitHubPrSummaryPayload>, String> {
    let manager = get_project_manager().await;
    let cli = GitHubCli::new();
    github_search_prs_impl(Arc::clone(&manager), &cli, query, 50).await
}

#[tauri::command]
pub async fn github_get_pr_details(
    _app: AppHandle,
    number: u64,
) -> Result<GitHubPrDetailsPayload, String> {
    let manager = get_project_manager().await;
    let cli = GitHubCli::new();
    github_get_pr_details_impl(Arc::clone(&manager), &cli, number).await
}

#[tauri::command]
pub async fn github_preview_pr(
    _app: AppHandle,
    session_name: String,
) -> Result<PrPreviewPayload, String> {
    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let core = project.schaltwerk_core.read().await;
    let session = core
        .session_manager()
        .get_session(&session_name)
        .map_err(|e| format!("Session not found: {e}"))?;

    if session.session_state == schaltwerk::domains::sessions::SessionState::Spec {
        return Err("Cannot create PR for a spec session. Start the session first.".to_string());
    }

    let worktree_path = session.worktree_path.clone();
    let parent_branch = session.parent_branch.clone();
    let session_branch = session.branch.clone();

    let repository_config = core
        .database()
        .get_project_github_config(&project.path)
        .map_err(|e| format!("Failed to load GitHub config: {e}"))?;

    let default_branch = repository_config
        .as_ref()
        .map(|cfg| cfg.default_branch.clone())
        .unwrap_or_else(|| "main".to_string());

    let (commit_count, commit_summaries) =
        get_commit_info(&worktree_path, &parent_branch).unwrap_or((0, vec![]));

    let has_uncommitted =
        schaltwerk::domains::git::has_uncommitted_changes(&worktree_path).unwrap_or(false);

    let default_title = if commit_count == 1 && !commit_summaries.is_empty() {
        commit_summaries[0].clone()
    } else {
        format_session_title(&session_name)
    };

    let default_body = if commit_summaries.is_empty() {
        session.initial_prompt.clone().unwrap_or_default()
    } else {
        commit_summaries
            .iter()
            .map(|s| format!("- {s}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let remote_status = schaltwerk::domains::git::branches::check_remote_branch_status(
        &project.path,
        &session_branch,
    );

    Ok(PrPreviewPayload {
        session_name,
        session_branch,
        parent_branch,
        default_title,
        default_body,
        commit_count,
        commit_summaries,
        default_branch,
        worktree_path: worktree_path.to_string_lossy().to_string(),
        has_uncommitted_changes: has_uncommitted,
        branch_pushed: remote_status.exists_on_remote,
        branch_conflict_warning: remote_status.conflict_warning,
    })
}

#[tauri::command]
pub async fn github_get_pr_review_comments(
    _app: AppHandle,
    pr_number: u64,
) -> Result<Vec<GitHubPrReviewCommentPayload>, String> {
    let manager = get_project_manager().await;
    let cli = GitHubCli::new();
    github_get_pr_review_comments_impl(Arc::clone(&manager), &cli, pr_number).await
}

async fn github_get_pr_review_comments_impl<R: CommandRunner>(
    project_manager: Arc<ProjectManager>,
    cli: &GitHubCli<R>,
    pr_number: u64,
) -> Result<Vec<GitHubPrReviewCommentPayload>, String> {
    let project_path = resolve_project_path(project_manager).await?;

    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let comments = cli
        .get_pr_review_comments(&project_path, pr_number)
        .map_err(|err| {
            error!("GitHub PR review comments fetch failed: {err}");
            format_cli_error(err)
        })?;

    Ok(comments.into_iter().map(map_pr_review_comment_payload).collect())
}

fn get_commit_info(worktree_path: &std::path::Path, base_branch: &str) -> Option<(usize, Vec<String>)> {
    use git2::Repository;

    let repo = Repository::open(worktree_path).ok()?;

    let head = repo.head().ok()?;
    let head_commit = head.peel_to_commit().ok()?;

    let base_ref = format!("refs/heads/{base_branch}");
    let base_oid = repo
        .find_reference(&base_ref)
        .or_else(|_| repo.find_reference(&format!("refs/remotes/origin/{base_branch}")))
        .ok()
        .and_then(|r| r.peel_to_commit().ok())
        .map(|c| c.id())?;

    let merge_base = repo.merge_base(base_oid, head_commit.id()).ok()?;

    let mut revwalk = repo.revwalk().ok()?;
    revwalk.push(head_commit.id()).ok()?;
    revwalk.hide(merge_base).ok()?;

    let mut summaries = Vec::new();
    for oid in revwalk.flatten() {
        if let Ok(commit) = repo.find_commit(oid) {
            let summary = commit
                .summary()
                .unwrap_or("(no message)")
                .to_string();
            summaries.push(summary);
        }
    }

    Some((summaries.len(), summaries))
}

fn format_session_title(session_name: &str) -> String {
    session_name
        .replace(['_', '-'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

async fn github_search_issues_impl<R: CommandRunner>(
    project_manager: Arc<ProjectManager>,
    cli: &GitHubCli<R>,
    query: Option<String>,
    limit: usize,
) -> Result<Vec<GitHubIssueSummaryPayload>, String> {
    let project_path = resolve_project_path(project_manager).await?;

    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let search_query = query.unwrap_or_default();
    let issues = cli
        .search_issues(&project_path, search_query.trim(), limit)
        .map_err(|err| {
            error!("GitHub issue search failed: {err}");
            format_cli_error(err)
        })?;

    Ok(issues.into_iter().map(map_issue_summary_payload).collect())
}

async fn github_get_issue_details_impl<R: CommandRunner>(
    project_manager: Arc<ProjectManager>,
    cli: &GitHubCli<R>,
    number: u64,
) -> Result<GitHubIssueDetailsPayload, String> {
    let project_path = resolve_project_path(project_manager).await?;

    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let details = cli
        .get_issue_with_comments(&project_path, number)
        .map_err(|err| {
            error!("GitHub issue detail fetch failed: {err}");
            format_cli_error(err)
        })?;

    Ok(map_issue_details_payload(details))
}

async fn github_search_prs_impl<R: CommandRunner>(
    project_manager: Arc<ProjectManager>,
    cli: &GitHubCli<R>,
    query: Option<String>,
    limit: usize,
) -> Result<Vec<GitHubPrSummaryPayload>, String> {
    let project_path = resolve_project_path(project_manager).await?;

    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let search_query = query.unwrap_or_default();
    let prs = cli
        .search_prs(&project_path, search_query.trim(), limit)
        .map_err(|err| {
            error!("GitHub PR search failed: {err}");
            format_cli_error(err)
        })?;

    Ok(prs.into_iter().map(map_pr_summary_payload).collect())
}

async fn github_get_pr_details_impl<R: CommandRunner>(
    project_manager: Arc<ProjectManager>,
    cli: &GitHubCli<R>,
    number: u64,
) -> Result<GitHubPrDetailsPayload, String> {
    let project_path = resolve_project_path(project_manager).await?;

    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let details = cli
        .get_pr_with_comments(&project_path, number)
        .map_err(|err| {
            error!("GitHub PR detail fetch failed: {err}");
            format_cli_error(err)
        })?;

    Ok(map_pr_details_payload(details))
}

async fn resolve_project_path(project_manager: Arc<ProjectManager>) -> Result<PathBuf, String> {
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let project_path = project.path.clone();
    let has_repository = {
        let core = project.schaltwerk_core.read().await;
        let db = core.database();
        db.get_project_github_config(&project.path)
            .map_err(|e| format!("Failed to load GitHub project config: {e}"))?
            .is_some()
    };

    if !has_repository {
        return Err(repo_not_connected_error());
    }

    Ok(project_path)
}

fn map_issue_summary_payload(issue: GitHubIssueSummary) -> GitHubIssueSummaryPayload {
    GitHubIssueSummaryPayload {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        updated_at: issue.updated_at,
        author: issue.author_login,
        labels: issue
            .labels
            .into_iter()
            .map(map_issue_label_payload)
            .collect(),
        url: issue.url,
    }
}

fn map_issue_label_payload(label: GitHubIssueLabel) -> GitHubIssueLabelPayload {
    GitHubIssueLabelPayload {
        name: label.name,
        color: label.color,
    }
}

fn map_issue_comment_payload(comment: GitHubIssueComment) -> GitHubIssueCommentPayload {
    GitHubIssueCommentPayload {
        author: comment.author_login,
        created_at: comment.created_at,
        body: comment.body,
    }
}

fn map_issue_details_payload(details: GitHubIssueDetails) -> GitHubIssueDetailsPayload {
    GitHubIssueDetailsPayload {
        number: details.number,
        title: details.title,
        url: details.url,
        body: details.body,
        labels: details
            .labels
            .into_iter()
            .map(map_issue_label_payload)
            .collect(),
        comments: details
            .comments
            .into_iter()
            .map(map_issue_comment_payload)
            .collect(),
    }
}

fn map_pr_summary_payload(pr: GitHubPrSummary) -> GitHubPrSummaryPayload {
    GitHubPrSummaryPayload {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        updated_at: pr.updated_at,
        author: pr.author_login,
        labels: pr.labels.into_iter().map(map_issue_label_payload).collect(),
        url: pr.url,
        head_ref_name: pr.head_ref_name,
    }
}

fn map_pr_review_payload(review: GitHubPrReview) -> GitHubPrReviewPayload {
    GitHubPrReviewPayload {
        author: review.author_login,
        state: review.state,
        submitted_at: review.submitted_at,
    }
}

fn map_pr_details_payload(details: GitHubPrDetails) -> GitHubPrDetailsPayload {
    let status_check_state = calculate_status_check_state(&details.status_check_rollup);

    GitHubPrDetailsPayload {
        number: details.number,
        title: details.title,
        url: details.url,
        body: details.body,
        labels: details
            .labels
            .into_iter()
            .map(map_issue_label_payload)
            .collect(),
        comments: details
            .comments
            .into_iter()
            .map(map_issue_comment_payload)
            .collect(),
        head_ref_name: details.head_ref_name,
        review_decision: details.review_decision,
        status_check_state,
        latest_reviews: details
            .latest_reviews
            .into_iter()
            .map(map_pr_review_payload)
            .collect(),
    }
}

fn calculate_status_check_state(checks: &[GitHubStatusCheck]) -> Option<String> {
    if checks.is_empty() {
        return None;
    }

    let mut has_failure = false;
    let mut has_pending = false;

    for check in checks {
        match check.conclusion.as_deref() {
            Some("FAILURE") | Some("TIMED_OUT") | Some("ACTION_REQUIRED") | Some("CANCELLED") => {
                has_failure = true;
            }
            Some("SUCCESS") | Some("NEUTRAL") | Some("SKIPPED") => {}
            _ => {
                if check
                    .status
                    .as_deref()
                    .is_some_and(|status| status != "COMPLETED")
                {
                    has_pending = true;
                }
            }
        }
    }

    if has_failure {
        Some("FAILURE".to_string())
    } else if has_pending {
        Some("PENDING".to_string())
    } else {
        Some("SUCCESS".to_string())
    }
}

fn map_pr_review_comment_payload(comment: GitHubPrReviewComment) -> GitHubPrReviewCommentPayload {
    GitHubPrReviewCommentPayload {
        id: comment.id,
        path: comment.path,
        line: comment.line,
        body: comment.body,
        author: comment.author_login,
        created_at: comment.created_at,
        html_url: comment.html_url,
        in_reply_to_id: comment.in_reply_to_id,
    }
}

async fn build_status() -> Result<GitHubStatusPayload, String> {
    let project_manager = get_project_manager().await;
    let repository_payload = match project_manager.current_project().await {
        Ok(project) => {
            let core = project.schaltwerk_core.read().await;
            let db = core.database();
            db.get_project_github_config(&project.path)
                .map_err(|e| format!("Failed to load GitHub project config: {e}"))?
                .map(|cfg| GitHubRepositoryPayload {
                    name_with_owner: cfg.repository,
                    default_branch: cfg.default_branch,
                })
        }
        Err(_) => None,
    };

    let cli = GitHubCli::new();
    let installed = match cli.ensure_installed() {
        Ok(()) => true,
        Err(GitHubCliError::NotInstalled) => false,
        Err(err) => return Err(format_cli_error(err)),
    };

    let (authenticated, user_login) = if installed {
        match cli.check_auth() {
            Ok(status) => (status.authenticated, status.user_login),
            Err(GitHubCliError::NotInstalled) => (false, None),
            Err(err) => return Err(format_cli_error(err)),
        }
    } else {
        (false, None)
    };

    Ok(GitHubStatusPayload {
        installed,
        authenticated,
        user_login,
        repository: repository_payload,
    })
}

fn emit_status(app: &AppHandle, status: &GitHubStatusPayload) -> Result<(), String> {
    emit_event(app, SchaltEvent::GitHubStatusChanged, status)
        .map_err(|e| format!("Failed to emit GitHub status event: {e}"))
}

fn repo_not_connected_error() -> String {
    "Project is not connected to a GitHub repository. Connect the project in Settings and try again."
        .to_string()
}

fn format_cli_error(err: GitHubCliError) -> String {
    match err {
        GitHubCliError::NotInstalled => {
            "GitHub CLI (gh) is not installed. Install it via `brew install gh`.".to_string()
        }
        GitHubCliError::CommandFailed {
            program,
            args,
            stdout,
            stderr,
            ..
        } => {
            let details = if !stderr.trim().is_empty() {
                stderr
            } else {
                stdout
            };
            format!(
                "{} command failed ({}): {}",
                program,
                args.join(" "),
                details.trim()
            )
        }
        GitHubCliError::Io(err) => err.to_string(),
        GitHubCliError::Json(err) => format!("Failed to parse GitHub CLI response: {err}"),
        GitHubCliError::Git(err) => format!("Git operation failed: {err}"),
        GitHubCliError::InvalidInput(msg) => msg,
        GitHubCliError::InvalidOutput(msg) => msg,
        GitHubCliError::NoGitRemote => {
            "No Git remotes configured for this project. Add a remote (e.g. `git remote add origin ...`) and try again.".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;
    use schaltwerk::project_manager::ProjectManager;
    use schaltwerk::services::CommandOutput;
    use std::collections::VecDeque;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    #[derive(Default, Clone)]
    struct MockRunner {
        calls: Arc<Mutex<Vec<CommandLog>>>,
        responses: Arc<Mutex<VecDeque<io::Result<CommandOutput>>>>,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct CommandLog {
        program: String,
        args: Vec<String>,
        cwd: Option<PathBuf>,
    }

    impl MockRunner {
        fn push_response(&self, response: io::Result<CommandOutput>) {
            self.responses.lock().unwrap().push_back(response);
        }

        fn calls(&self) -> Vec<CommandLog> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl CommandRunner for MockRunner {
        fn run(
            &self,
            program: &str,
            args: &[&str],
            current_dir: Option<&Path>,
            _env: &[(&str, &str)],
        ) -> io::Result<CommandOutput> {
            self.calls.lock().unwrap().push(CommandLog {
                program: program.to_string(),
                args: args.iter().map(|s| s.to_string()).collect(),
                cwd: current_dir.map(|p| p.to_path_buf()),
            });
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("no response configured")
        }
    }

    struct TempHomeGuard {
        previous: Option<String>,
        _temp_dir: TempDir,
    }

    impl TempHomeGuard {
        fn new() -> Self {
            use schaltwerk::utils::env_adapter::EnvAdapter;
            let temp_dir = TempDir::new().expect("temp home directory");
            let previous = std::env::var("HOME").ok();
            EnvAdapter::set_var("HOME", &temp_dir.path().to_string_lossy());
            Self {
                previous,
                _temp_dir: temp_dir,
            }
        }
    }

    impl Drop for TempHomeGuard {
        fn drop(&mut self) {
            use schaltwerk::utils::env_adapter::EnvAdapter;
            if let Some(prev) = &self.previous {
                EnvAdapter::set_var("HOME", prev);
            } else {
                EnvAdapter::remove_var("HOME");
            }
        }
    }

    fn init_repo(path: &Path) {
        let repo = Repository::init(path).unwrap();
        if repo.find_remote("origin").is_err() {
            repo.remote("origin", "https://github.com/example/repo")
                .unwrap();
        }
    }

    async fn configure_repo(manager: &Arc<ProjectManager>, path: &Path) -> TempHomeGuard {
        let guard = TempHomeGuard::new();
        let project = manager
            .switch_to_project(path.to_path_buf())
            .await
            .expect("project");

        {
            let core = project.schaltwerk_core.write().await;
            let db = core.database();
            let config = ProjectGithubConfig {
                repository: "example/repo".to_string(),
                default_branch: "main".to_string(),
            };
            db.set_project_github_config(&project.path, &config)
                .expect("set github config");
        }

        guard
    }

    #[tokio::test]
    async fn github_search_issues_impl_returns_payload() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "gh version 2.0".to_string(),
            stderr: String::new(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "[{\"number\":1,\"title\":\"Bug\",\"state\":\"OPEN\",\"updatedAt\":\"2024-01-01T00:00:00Z\",\"author\":{\"login\":\"octocat\"},\"labels\":[{\"name\":\"bug\",\"color\":\"d73a4a\"}],\"url\":\"https://github.com/example/repo/issues/1\"}]".to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let manager = Arc::new(ProjectManager::new());
        let temp = TempDir::new().unwrap();
        init_repo(temp.path());
        let _home_guard = configure_repo(&manager, temp.path()).await;

        let results =
            github_search_issues_impl(Arc::clone(&manager), &cli, Some(" bug ".to_string()), 20)
                .await
                .expect("search results");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].number, 1);
        assert_eq!(results[0].labels.len(), 1);
        assert_eq!(results[0].labels[0].name, "bug");
        assert_eq!(runner.calls().len(), 2);
    }

    #[tokio::test]
    async fn github_get_issue_details_impl_requires_repository_connection() {
        let runner = MockRunner::default();
        let cli = GitHubCli::with_runner(runner.clone());

        let manager = Arc::new(ProjectManager::new());
        let temp = TempDir::new().unwrap();
        init_repo(temp.path());
        let _home_guard = TempHomeGuard::new();
        manager
            .switch_to_project(temp.path().to_path_buf())
            .await
            .unwrap();

        let err = github_get_issue_details_impl(Arc::clone(&manager), &cli, 11)
            .await
            .expect_err("should require repo connection");

        assert_eq!(err, repo_not_connected_error());
        assert!(runner.calls().is_empty());
    }

    #[tokio::test]
    async fn github_search_issues_impl_requires_repository_connection() {
        let runner = MockRunner::default();
        let cli = GitHubCli::with_runner(runner.clone());

        let manager = Arc::new(ProjectManager::new());
        let temp = TempDir::new().unwrap();
        init_repo(temp.path());
        let _home_guard = TempHomeGuard::new();
        manager
            .switch_to_project(temp.path().to_path_buf())
            .await
            .unwrap();

        let err = github_search_issues_impl(Arc::clone(&manager), &cli, None, 20)
            .await
            .expect_err("should require repo connection");

        assert_eq!(err, repo_not_connected_error());
        assert!(runner.calls().is_empty());
    }

    #[tokio::test]
    async fn github_get_issue_details_impl_returns_payload() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "gh version 2.0".to_string(),
            stderr: String::new(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "{\"number\":5,\"title\":\"Crash\",\"url\":\"https://github.com/example/repo/issues/5\",\"body\":\"Steps\",\"labels\":[{\"name\":\"bug\",\"color\":\"f00\"}],\"comments\":{\"nodes\":[{\"author\":{\"login\":\"octocat\"},\"createdAt\":\"2024-01-02T00:00:00Z\",\"body\":\"Confirm\"}]}}".to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let manager = Arc::new(ProjectManager::new());
        let temp = TempDir::new().unwrap();
        init_repo(temp.path());
        let _home_guard = configure_repo(&manager, temp.path()).await;

        let payload = github_get_issue_details_impl(Arc::clone(&manager), &cli, 5)
            .await
            .expect("issue details");

        assert_eq!(payload.number, 5);
        assert_eq!(payload.title, "Crash");
        assert_eq!(payload.comments.len(), 1);
        assert_eq!(payload.comments[0].author.as_deref(), Some("octocat"));
        assert_eq!(runner.calls().len(), 2);
    }

    #[tokio::test]
    async fn github_get_issue_details_impl_propagates_cli_errors() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "gh version 2.0".to_string(),
            stderr: String::new(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "not-json".to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let manager = Arc::new(ProjectManager::new());
        let temp = TempDir::new().unwrap();
        init_repo(temp.path());
        let _home_guard = configure_repo(&manager, temp.path()).await;

        let err = github_get_issue_details_impl(Arc::clone(&manager), &cli, 9)
            .await
            .expect_err("should propagate CLI error");

        assert_eq!(
            err,
            "GitHub CLI returned issue detail data in an unexpected format."
        );
        assert_eq!(runner.calls().len(), 2);
    }
}

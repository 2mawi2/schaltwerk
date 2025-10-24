use crate::get_project_manager;
use log::{error, info};
use schaltwerk::domains::git::github_cli::{
    CommandRunner, CreatePrOptions, GitHubCli, GitHubCliError, GitHubIssueComment,
    GitHubIssueDetails, GitHubIssueLabel, GitHubIssueSummary,
};
use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};
use schaltwerk::project_manager::ProjectManager;
use schaltwerk::schaltwerk_core::db_project_config::{ProjectConfigMethods, ProjectGithubConfig};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReviewedPrArgs {
    pub session_slug: String,
    pub worktree_path: String,
    pub default_branch: Option<String>,
    pub commit_message: Option<String>,
    pub repository: Option<String>,
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
    let err = cli.authenticate().unwrap_err();
    error!("GitHub authentication requires user action: {err}");
    Err(format_cli_error(err))
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
    app: AppHandle,
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
    let pr_result = cli
        .create_pr_from_worktree(CreatePrOptions {
            repo_path: &project_path,
            worktree_path: &worktree_path,
            session_slug: &args.session_slug,
            default_branch: &default_branch,
            commit_message: args.commit_message.as_deref(),
            repository: repository.as_deref(),
        })
        .map_err(|err| {
            error!("GitHub PR creation failed: {err}");
            format_cli_error(err)
        })?;

    let payload = GitHubPrPayload {
        branch: pr_result.branch,
        url: pr_result.url,
    };

    let status = build_status().await?;
    emit_status(&app, &status)?;
    Ok(payload)
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
    use schaltwerk::domains::git::github_cli::CommandOutput;
    use schaltwerk::project_manager::ProjectManager;
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
            let temp_dir = TempDir::new().expect("temp home directory");
            let previous = std::env::var("HOME").ok();
            std::env::set_var("HOME", temp_dir.path());
            Self {
                previous,
                _temp_dir: temp_dir,
            }
        }
    }

    impl Drop for TempHomeGuard {
        fn drop(&mut self) {
            if let Some(prev) = &self.previous {
                std::env::set_var("HOME", prev);
            } else {
                std::env::remove_var("HOME");
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

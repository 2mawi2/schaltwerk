use crate::get_project_manager;
use log::{error, info};
use schaltwerk::domains::git::github_cli::{CreatePrOptions, GitHubCli, GitHubCliError};
use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};
use schaltwerk::schaltwerk_core::db_project_config::{ProjectConfigMethods, ProjectGithubConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
        let core = project.schaltwerk_core.lock().await;
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
        let core = project.schaltwerk_core.lock().await;
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

async fn build_status() -> Result<GitHubStatusPayload, String> {
    let project_manager = get_project_manager().await;
    let repository_payload = match project_manager.current_project().await {
        Ok(project) => {
            let core = project.schaltwerk_core.lock().await;
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

use std::env;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::OnceLock;

use anyhow::Error as AnyhowError;
use git2::Repository;
use log::{debug, info, warn};
use serde::Deserialize;

use super::branches::branch_exists;
use super::operations::{commit_all_changes, has_uncommitted_changes};
use super::repository::get_current_branch;
use super::worktrees::update_worktree_branch;

#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl CommandOutput {
    pub fn success(&self) -> bool {
        self.status.unwrap_or_default() == 0
    }
}

pub trait CommandRunner: Send + Sync {
    fn run(
        &self,
        program: &str,
        args: &[&str],
        current_dir: Option<&Path>,
        env: &[(&str, &str)],
    ) -> io::Result<CommandOutput>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubAuthStatus {
    pub authenticated: bool,
    pub user_login: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepositoryInfo {
    pub name_with_owner: String,
    pub default_branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubPrResult {
    pub branch: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubIssueLabel {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubIssueSummary {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author_login: Option<String>,
    pub labels: Vec<GitHubIssueLabel>,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubIssueComment {
    pub author_login: Option<String>,
    pub created_at: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubIssueDetails {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub body: String,
    pub labels: Vec<GitHubIssueLabel>,
    pub comments: Vec<GitHubIssueComment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubPrSummary {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author_login: Option<String>,
    pub labels: Vec<GitHubIssueLabel>,
    pub url: String,
    pub head_ref_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubPrDetails {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub body: String,
    pub labels: Vec<GitHubIssueLabel>,
    pub comments: Vec<GitHubIssueComment>,
    pub head_ref_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubPrReviewComment {
    pub id: u64,
    pub path: String,
    pub line: Option<u64>,
    pub body: String,
    pub author_login: Option<String>,
    pub created_at: String,
    pub html_url: String,
    pub in_reply_to_id: Option<u64>,
}

#[derive(Debug)]
pub enum GitHubCliError {
    NotInstalled,
    NoGitRemote,
    CommandFailed {
        program: String,
        args: Vec<String>,
        status: Option<i32>,
        stdout: String,
        stderr: String,
    },
    Io(io::Error),
    Json(serde_json::Error),
    Git(anyhow::Error),
    InvalidOutput(String),
}

impl std::fmt::Display for GitHubCliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitHubCliError::NotInstalled => write!(f, "GitHub CLI (gh) is not installed."),
            GitHubCliError::NoGitRemote => {
                write!(f, "No Git remotes configured for this repository.")
            }
            GitHubCliError::CommandFailed {
                program,
                status,
                stderr,
                ..
            } => write!(
                f,
                "Command `{program}` failed with status {status:?}: {stderr}"
            ),
            GitHubCliError::Io(err) => write!(f, "IO error: {err}"),
            GitHubCliError::Json(err) => write!(f, "JSON error: {err}"),
            GitHubCliError::Git(err) => write!(f, "Git error: {err}"),
            GitHubCliError::InvalidOutput(msg) => write!(f, "Invalid CLI output: {msg}"),
        }
    }
}

impl std::error::Error for GitHubCliError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            GitHubCliError::Io(err) => Some(err),
            GitHubCliError::Json(err) => Some(err),
            GitHubCliError::Git(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<serde_json::Error> for GitHubCliError {
    fn from(value: serde_json::Error) -> Self {
        GitHubCliError::Json(value)
    }
}

pub struct SystemCommandRunner;

impl CommandRunner for SystemCommandRunner {
    fn run(
        &self,
        program: &str,
        args: &[&str],
        current_dir: Option<&Path>,
        env: &[(&str, &str)],
    ) -> io::Result<CommandOutput> {
        let mut cmd = StdCommand::new(program);
        cmd.args(args);
        if let Some(dir) = current_dir {
            cmd.current_dir(dir);
        }
        for (key, value) in env {
            cmd.env(key, value);
        }

        // Many user installations of GitHub CLI live outside the default PATH that
        // Tauri-provided processes inherit on macOS. To match the behaviour users
        // expect from their login shell, append common Homebrew and /usr/local
        // locations unless the caller explicitly overrides PATH.
        #[cfg(target_os = "macos")]
        {
            const EXTRA_PATHS: &[&str] = &[
                "/opt/homebrew/bin",
                "/opt/homebrew/sbin",
                "/usr/local/bin",
                "/usr/local/sbin",
            ];

            let overrides_path = env.iter().any(|(key, _)| *key == "PATH");
            if !overrides_path {
                let mut path_entries: Vec<PathBuf> = env::var_os("PATH")
                    .map(|value| env::split_paths(&value).collect())
                    .unwrap_or_default();

                for candidate in EXTRA_PATHS {
                    let candidate_path = PathBuf::from(candidate);
                    if !path_entries
                        .iter()
                        .any(|existing| existing == &candidate_path)
                    {
                        path_entries.push(candidate_path);
                    }
                }

                if let Ok(joined) = env::join_paths(path_entries.iter()) {
                    cmd.env("PATH", joined);
                }
            }
        }

        let output = cmd.output()?;
        Ok(CommandOutput {
            status: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

pub struct GitHubCli<R: CommandRunner = SystemCommandRunner> {
    runner: R,
    program: String,
}

impl GitHubCli<SystemCommandRunner> {
    pub fn new() -> Self {
        Self {
            runner: SystemCommandRunner,
            program: resolve_github_cli_program(),
        }
    }
}

impl Default for GitHubCli<SystemCommandRunner> {
    fn default() -> Self {
        Self::new()
    }
}

impl<R: CommandRunner> GitHubCli<R> {
    pub fn with_runner(runner: R) -> Self {
        Self {
            runner,
            program: "gh".to_string(),
        }
    }

    pub fn ensure_installed(&self) -> Result<(), GitHubCliError> {
        debug!(
            "[GitHubCli] Checking if GitHub CLI is installed: program='{}', PATH={}",
            self.program,
            std::env::var("PATH").unwrap_or_else(|_| "<not set>".to_string())
        );
        match self.runner.run(&self.program, &["--version"], None, &[]) {
            Ok(output) => {
                if output.success() {
                    if GITHUB_CLI_VERSION_LOGGED.set(()).is_ok() {
                        info!("GitHub CLI detected: {}", output.stdout.trim());
                    } else {
                        debug!("GitHub CLI detected: {}", output.stdout.trim());
                    }
                    Ok(())
                } else {
                    debug!(
                        "GitHub CLI version command failed with status {:?}: stdout={}, stderr={}",
                        output.status, output.stdout, output.stderr
                    );
                    Err(GitHubCliError::NotInstalled)
                }
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                debug!("GitHub CLI binary not found at '{}'", self.program);
                Err(GitHubCliError::NotInstalled)
            }
            Err(err) => {
                debug!("GitHub CLI check failed with IO error: {err}");
                Err(GitHubCliError::Io(err))
            }
        }
    }

    pub fn check_auth(&self) -> Result<GitHubAuthStatus, GitHubCliError> {
        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let args = ["auth", "status", "--hostname", "github.com"];

        debug!("Running gh auth status check");
        let output = self
            .runner
            .run(&self.program, &args, None, &env)
            .map_err(map_runner_error)?;

        debug!(
            "gh auth status result: exit={:?}, stdout_len={}, stderr_len={}",
            output.status,
            output.stdout.len(),
            output.stderr.len()
        );

        if output.success() {
            let env_user = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
            let user_args = ["api", "user"];
            match self.runner.run(&self.program, &user_args, None, &env_user) {
                Ok(user_output) if user_output.success() => {
                    #[derive(serde::Deserialize)]
                    struct UserResponse {
                        login: String,
                    }

                    let clean_output = strip_ansi_codes(&user_output.stdout);
                    let login = serde_json::from_str::<UserResponse>(&clean_output)
                        .ok()
                        .map(|u| u.login);
                    if GITHUB_AUTH_LOGGED.set(()).is_ok() {
                        info!("GitHub authentication verified for {login:?}");
                    } else {
                        debug!("GitHub authentication verified for {login:?}");
                    }
                    return Ok(GitHubAuthStatus {
                        authenticated: true,
                        user_login: login,
                    });
                }
                Ok(_) => {
                    if GITHUB_AUTH_LOGGED.set(()).is_ok() {
                        info!("GitHub authentication verified but failed to get user info");
                    } else {
                        debug!("GitHub authentication verified but failed to get user info");
                    }
                    return Ok(GitHubAuthStatus {
                        authenticated: true,
                        user_login: None,
                    });
                }
                Err(e) => {
                    debug!("Failed to get user info: {e}");
                    return Ok(GitHubAuthStatus {
                        authenticated: true,
                        user_login: None,
                    });
                }
            }
        }

        debug!("GitHub CLI reports unauthenticated state");
        Ok(GitHubAuthStatus {
            authenticated: false,
            user_login: None,
        })
    }

    pub fn view_repository(
        &self,
        project_path: &Path,
    ) -> Result<GitHubRepositoryInfo, GitHubCliError> {
        debug!(
            "[GitHubCli] Viewing repository info for project: {}",
            project_path.display()
        );
        ensure_git_remote_exists(project_path)?;

        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let args = ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"];

        let output = self
            .runner
            .run(&self.program, &args, Some(project_path), &env)
            .map_err(map_runner_error)?;

        debug!(
            "[GitHubCli] gh repo view result: exit={:?}, stdout_len={}, stderr_len={}",
            output.status,
            output.stdout.len(),
            output.stderr.len()
        );

        if !output.success() {
            let arg_vec: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            debug!("[GitHubCli] gh repo view failed: stderr={}", output.stderr);
            return Err(command_failure(&self.program, &arg_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let response: RepoViewResponse =
            serde_json::from_str(clean_output.trim()).map_err(|err| {
                log::error!(
                    "[GitHubCli] Failed to parse repo view response: {err}; raw={}, cleaned={}",
                    output.stdout.trim(),
                    clean_output.trim()
                );
                GitHubCliError::InvalidOutput(
                    "GitHub CLI returned data in an unexpected format.".to_string(),
                )
            })?;
        let default_branch = response
            .default_branch_ref
            .and_then(|branch| branch.name)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "main".to_string());

        info!(
            "[GitHubCli] Repository info retrieved: {}, default_branch={}",
            response.name_with_owner, default_branch
        );

        Ok(GitHubRepositoryInfo {
            name_with_owner: response.name_with_owner,
            default_branch,
        })
    }

    pub fn search_issues(
        &self,
        project_path: &Path,
        query: &str,
        limit: usize,
    ) -> Result<Vec<GitHubIssueSummary>, GitHubCliError> {
        debug!(
            "[GitHubCli] Searching issues for project={}, query='{}', limit={}",
            project_path.display(),
            query,
            limit
        );
        ensure_git_remote_exists(project_path)?;

        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let constrained_limit = limit.clamp(1, 100);
        let trimmed_query = query.trim();

        let mut args_vec = vec![
            "issue".to_string(),
            "list".to_string(),
            "--json".to_string(),
            "number,title,state,updatedAt,author,labels,url".to_string(),
            "--limit".to_string(),
            constrained_limit.to_string(),
        ];

        let (normalized_query, label_filters) = split_label_filters(trimmed_query);

        if normalized_query.is_empty() {
            args_vec.push("--state".to_string());
            args_vec.push("open".to_string());
        } else {
            args_vec.push("--search".to_string());
            args_vec.push(normalized_query);
            args_vec.push("--state".to_string());
            args_vec.push("all".to_string());
        }
        for label_filter in label_filters {
            args_vec.push("--label".to_string());
            args_vec.push(label_filter);
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|entry| entry.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let parsed: Vec<IssueListResponse> =
            serde_json::from_str(clean_output.trim()).map_err(|err| {
                log::error!(
                    "[GitHubCli] Failed to parse issue search response: {err}; raw={}, cleaned={}",
                    output.stdout.trim(),
                    clean_output.trim()
                );
                GitHubCliError::InvalidOutput(
                    "GitHub CLI returned issue data in an unexpected format.".to_string(),
                )
            })?;

        let mut results: Vec<GitHubIssueSummary> = parsed
            .into_iter()
            .map(|issue| GitHubIssueSummary {
                number: issue.number,
                title: issue.title,
                state: issue.state,
                updated_at: issue.updated_at,
                author_login: issue.author.and_then(|actor| actor.login),
                labels: issue
                    .labels
                    .into_iter()
                    .map(|label| GitHubIssueLabel {
                        name: label.name,
                        color: label.color,
                    })
                    .collect(),
                url: issue.url,
            })
            .collect();

        fn parse_timestamp(value: &str) -> i64 {
            chrono::DateTime::parse_from_rfc3339(value)
                .map(|dt| dt.timestamp())
                .unwrap_or(i64::MIN)
        }

        results.sort_by(|a, b| {
            let b_key = parse_timestamp(&b.updated_at);
            let a_key = parse_timestamp(&a.updated_at);
            b_key.cmp(&a_key).then_with(|| a.number.cmp(&b.number))
        });

        Ok(results)
    }

    pub fn get_issue_with_comments(
        &self,
        project_path: &Path,
        number: u64,
    ) -> Result<GitHubIssueDetails, GitHubCliError> {
        debug!(
            "[GitHubCli] Fetching issue details for project={}, number={}",
            project_path.display(),
            number
        );
        ensure_git_remote_exists(project_path)?;

        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let args_vec = vec![
            "issue".to_string(),
            "view".to_string(),
            number.to_string(),
            "--json".to_string(),
            "number,title,body,url,labels,comments".to_string(),
        ];

        let arg_refs: Vec<&str> = args_vec.iter().map(|entry| entry.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let parsed: IssueDetailsResponse =
            serde_json::from_str(clean_output.trim()).map_err(|err| {
                log::error!(
                    "[GitHubCli] Failed to parse issue detail response: {err}; raw={}, cleaned={}",
                    output.stdout.trim(),
                    clean_output.trim()
                );
                GitHubCliError::InvalidOutput(
                    "GitHub CLI returned issue detail data in an unexpected format.".to_string(),
                )
            })?;

        let labels = parsed
            .labels
            .into_iter()
            .map(|label| GitHubIssueLabel {
                name: label.name,
                color: label.color,
            })
            .collect();

        let comment_nodes = match parsed.comments.unwrap_or(IssueComments::None) {
            IssueComments::Connection { nodes } => nodes,
            IssueComments::List(nodes) => nodes,
            IssueComments::None => Vec::new(),
        };

        let comments = comment_nodes
            .into_iter()
            .map(|comment| GitHubIssueComment {
                author_login: comment.author.and_then(|actor| actor.login),
                created_at: comment.created_at.unwrap_or_default(),
                body: comment.body.unwrap_or_default(),
            })
            .collect();

        Ok(GitHubIssueDetails {
            number: parsed.number,
            title: parsed.title,
            url: parsed.url,
            body: parsed.body.unwrap_or_default(),
            labels,
            comments,
        })
    }

    pub fn search_prs(
        &self,
        project_path: &Path,
        query: &str,
        limit: usize,
    ) -> Result<Vec<GitHubPrSummary>, GitHubCliError> {
        debug!(
            "[GitHubCli] Searching PRs for project={}, query='{}', limit={}",
            project_path.display(),
            query,
            limit
        );
        ensure_git_remote_exists(project_path)?;

        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let constrained_limit = limit.clamp(1, 100);
        let trimmed_query = query.trim();

        let mut args_vec = vec![
            "pr".to_string(),
            "list".to_string(),
            "--json".to_string(),
            "number,title,state,updatedAt,author,labels,url,headRefName".to_string(),
            "--limit".to_string(),
            constrained_limit.to_string(),
        ];

        if trimmed_query.is_empty() {
            args_vec.push("--state".to_string());
            args_vec.push("open".to_string());
        } else {
            args_vec.push("--search".to_string());
            args_vec.push(trimmed_query.to_string());
            args_vec.push("--state".to_string());
            args_vec.push("all".to_string());
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|entry| entry.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let parsed: Vec<PrListResponse> =
            serde_json::from_str(clean_output.trim()).map_err(|err| {
                log::error!(
                    "[GitHubCli] Failed to parse PR search response: {err}; raw={}, cleaned={}",
                    output.stdout.trim(),
                    clean_output.trim()
                );
                GitHubCliError::InvalidOutput(
                    "GitHub CLI returned PR data in an unexpected format.".to_string(),
                )
            })?;

        let mut results: Vec<GitHubPrSummary> = parsed
            .into_iter()
            .map(|pr| GitHubPrSummary {
                number: pr.number,
                title: pr.title,
                state: pr.state,
                updated_at: pr.updated_at,
                author_login: pr.author.and_then(|actor| actor.login),
                labels: pr
                    .labels
                    .into_iter()
                    .map(|label| GitHubIssueLabel {
                        name: label.name,
                        color: label.color,
                    })
                    .collect(),
                url: pr.url,
                head_ref_name: pr.head_ref_name,
            })
            .collect();

        fn parse_timestamp(value: &str) -> i64 {
            chrono::DateTime::parse_from_rfc3339(value)
                .map(|dt| dt.timestamp())
                .unwrap_or(i64::MIN)
        }

        results.sort_by(|a, b| {
            let b_key = parse_timestamp(&b.updated_at);
            let a_key = parse_timestamp(&a.updated_at);
            b_key.cmp(&a_key).then_with(|| a.number.cmp(&b.number))
        });

        Ok(results)
    }

    pub fn get_pr_with_comments(
        &self,
        project_path: &Path,
        number: u64,
    ) -> Result<GitHubPrDetails, GitHubCliError> {
        debug!(
            "[GitHubCli] Fetching PR details for project={}, number={}",
            project_path.display(),
            number
        );
        ensure_git_remote_exists(project_path)?;

        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let args_vec = vec![
            "pr".to_string(),
            "view".to_string(),
            number.to_string(),
            "--json".to_string(),
            "number,title,body,url,labels,comments,headRefName".to_string(),
        ];

        let arg_refs: Vec<&str> = args_vec.iter().map(|entry| entry.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let parsed: PrDetailsResponse =
            serde_json::from_str(clean_output.trim()).map_err(|err| {
                log::error!(
                    "[GitHubCli] Failed to parse PR detail response: {err}; raw={}, cleaned={}",
                    output.stdout.trim(),
                    clean_output.trim()
                );
                GitHubCliError::InvalidOutput(
                    "GitHub CLI returned PR detail data in an unexpected format.".to_string(),
                )
            })?;

        let labels = parsed
            .labels
            .into_iter()
            .map(|label| GitHubIssueLabel {
                name: label.name,
                color: label.color,
            })
            .collect();

        let comment_nodes = match parsed.comments.unwrap_or(IssueComments::None) {
            IssueComments::Connection { nodes } => nodes,
            IssueComments::List(nodes) => nodes,
            IssueComments::None => Vec::new(),
        };

        let comments = comment_nodes
            .into_iter()
            .map(|comment| GitHubIssueComment {
                author_login: comment.author.and_then(|actor| actor.login),
                created_at: comment.created_at.unwrap_or_default(),
                body: comment.body.unwrap_or_default(),
            })
            .collect();

        Ok(GitHubPrDetails {
            number: parsed.number,
            title: parsed.title,
            url: parsed.url,
            body: parsed.body.unwrap_or_default(),
            labels,
            comments,
            head_ref_name: parsed.head_ref_name,
        })
    }

    pub fn get_pr_review_comments(
        &self,
        project_path: &Path,
        pr_number: u64,
    ) -> Result<Vec<GitHubPrReviewComment>, GitHubCliError> {
        debug!(
            "[GitHubCli] Fetching PR review comments for project={}, pr_number={}",
            project_path.display(),
            pr_number
        );
        ensure_git_remote_exists(project_path)?;

        let repo_info = self.view_repository(project_path)?;
        let api_path = format!("repos/{}/pulls/{}/comments", repo_info.name_with_owner, pr_number);

        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let args_vec = vec![
            "api".to_string(),
            api_path.clone(),
        ];

        let arg_refs: Vec<&str> = args_vec.iter().map(|entry| entry.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let parsed: Vec<PrReviewCommentResponse> =
            serde_json::from_str(clean_output.trim()).map_err(|err| {
                log::error!(
                    "[GitHubCli] Failed to parse PR review comments response: {err}; raw={}, cleaned={}",
                    output.stdout.trim(),
                    clean_output.trim()
                );
                GitHubCliError::InvalidOutput(
                    "GitHub CLI returned PR review comments in an unexpected format.".to_string(),
                )
            })?;

        let comments = parsed
            .into_iter()
            .map(|comment| GitHubPrReviewComment {
                id: comment.id,
                path: comment.path,
                line: comment.line.or(comment.original_line),
                body: comment.body,
                author_login: comment.user.and_then(|u| u.login),
                created_at: comment.created_at,
                html_url: comment.html_url,
                in_reply_to_id: comment.in_reply_to_id,
            })
            .collect();

        Ok(comments)
    }

    pub fn create_pr_from_worktree(
        &self,
        opts: CreatePrOptions<'_>,
    ) -> Result<GitHubPrResult, GitHubCliError> {
        info!(
            "Preparing GitHub PR for session '{session_slug}'",
            session_slug = opts.session_slug
        );

        let current_branch = get_current_branch(opts.worktree_path).map_err(GitHubCliError::Git)?;
        let mut target_branch = current_branch.clone();

        if current_branch == opts.default_branch {
            let sanitized_slug = sanitize_branch_component(opts.session_slug);
            target_branch = format!("reviewed/{sanitized_slug}");

            let repo = Repository::open(opts.repo_path)
                .map_err(|err| GitHubCliError::Git(AnyhowError::new(err)))?;

            if !branch_exists(opts.repo_path, &target_branch).map_err(GitHubCliError::Git)? {
                let head = repo
                    .head()
                    .and_then(|h| h.peel_to_commit())
                    .map_err(|err| GitHubCliError::Git(AnyhowError::new(err)))?;
                repo.branch(&target_branch, &head, false)
                    .map_err(|err| GitHubCliError::Git(AnyhowError::new(err)))?;
                debug!("Created branch '{target_branch}' for reviewed session");
            }

            update_worktree_branch(opts.worktree_path, &target_branch)
                .map_err(GitHubCliError::Git)?;
        }

        let commit_message = opts
            .commit_message
            .map(|msg| msg.trim().to_string())
            .filter(|msg| !msg.is_empty())
            .unwrap_or_else(|| format!("review: {}", opts.session_slug));

        if has_uncommitted_changes(opts.worktree_path).map_err(GitHubCliError::Git)? {
            debug!(
                "Staging and committing changes in '{}' before PR",
                opts.worktree_path.display()
            );
            commit_all_changes(opts.worktree_path, &commit_message).map_err(GitHubCliError::Git)?;
        } else {
            debug!("No uncommitted changes detected prior to PR creation");
        }

        self.push_branch(opts.worktree_path, &target_branch)?;

        let pr_url =
            self.create_pull_request(&target_branch, opts.repository, opts.worktree_path)?;

        Ok(GitHubPrResult {
            branch: target_branch,
            url: pr_url,
        })
    }

    fn push_branch(&self, worktree_path: &Path, branch_name: &str) -> Result<(), GitHubCliError> {
        let env = [("GIT_TERMINAL_PROMPT", "0")];
        let args = ["push"];

        let output = self
            .runner
            .run("git", &args, Some(worktree_path), &env)
            .map_err(map_runner_error)?;

        if output.success() {
            debug!("Successfully pushed branch '{branch_name}'");
            return Ok(());
        }

        let retry_args_vec = vec![
            "push".to_string(),
            "--set-upstream".to_string(),
            "origin".to_string(),
            branch_name.to_string(),
        ];
        let retry_args: Vec<&str> = retry_args_vec.iter().map(|s| s.as_str()).collect();

        let retry_output = self
            .runner
            .run("git", &retry_args, Some(worktree_path), &env)
            .map_err(map_runner_error)?;

        if retry_output.success() {
            debug!("Pushed branch '{branch_name}' with upstream configuration");
            return Ok(());
        }

        Err(command_failure("git", &retry_args_vec, retry_output))
    }

    fn create_pull_request(
        &self,
        branch_name: &str,
        repository: Option<&str>,
        worktree_path: &Path,
    ) -> Result<String, GitHubCliError> {
        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let mut args_vec = vec![
            "pr".to_string(),
            "create".to_string(),
            "--fill".to_string(),
            "--web".to_string(),
            "--head".to_string(),
            branch_name.to_string(),
        ];

        if let Some(repo) = repository {
            args_vec.push("--repo".to_string());
            args_vec.push(repo.to_string());
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();

        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(worktree_path), &env)
            .map_err(map_runner_error)?;

        if !output.success() {
            if let Some(existing_url) =
                self.view_existing_pr(branch_name, repository, worktree_path)?
            {
                info!("Reusing existing PR for branch '{branch_name}': {existing_url}");
                return Ok(existing_url);
            }
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let combined = combine_output(&output);
        debug!(
            "gh pr create output: stdout_len={}, stderr_len={}, combined='{}'",
            output.stdout.len(),
            output.stderr.len(),
            combined
        );

        if let Some(url) = extract_pr_url(&combined) {
            info!("Created PR for branch '{branch_name}': {url}");
            return Ok(url);
        }

        info!("PR form opened in browser with --web flag (no URL returned)");
        Ok(String::new())
    }

    fn view_existing_pr(
        &self,
        branch_name: &str,
        repository: Option<&str>,
        worktree_path: &Path,
    ) -> Result<Option<String>, GitHubCliError> {
        debug!("Attempting to view existing PR for branch '{branch_name}', repo: {repository:?}");
        let env = [("GH_PROMPT_DISABLED", "1"), ("NO_COLOR", "1")];
        let mut args_vec = vec![
            "pr".to_string(),
            "view".to_string(),
            branch_name.to_string(),
            "--json".to_string(),
            "url".to_string(),
        ];

        if let Some(repo) = repository {
            args_vec.push("--repo".to_string());
            args_vec.push(repo.to_string());
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(worktree_path), &env)
            .map_err(map_runner_error)?;

        debug!(
            "gh pr view result: exit={:?}, stdout='{}', stderr='{}'",
            output.status, output.stdout, output.stderr
        );

        if !output.success() {
            debug!("gh pr view failed, no existing PR found");
            return Ok(None);
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let response: PrViewResponse = serde_json::from_str(clean_output.trim())?;
        debug!("Successfully parsed PR URL from view: {}", response.url);
        Ok(Some(response.url))
    }

    pub fn authenticate(&self) -> Result<(), GitHubCliError> {
        Err(GitHubCliError::CommandFailed {
            program: "gh".to_string(),
            args: vec!["auth".to_string(), "login".to_string()],
            status: None,
            stdout: String::new(),
            stderr: "GitHub CLI authentication must be done in your terminal.\n\n\
                     To authenticate:\n\
                     1. Open your terminal\n\
                     2. Run: gh auth login\n\
                     3. Follow the prompts to authenticate\n\
                     4. Return to Schaltwerk and the status will update automatically"
                .to_string(),
        })
    }
}

pub struct CreatePrOptions<'a> {
    pub repo_path: &'a Path,
    pub worktree_path: &'a Path,
    pub session_slug: &'a str,
    pub default_branch: &'a str,
    pub commit_message: Option<&'a str>,
    pub repository: Option<&'a str>,
}

fn map_runner_error(err: io::Error) -> GitHubCliError {
    if err.kind() == io::ErrorKind::NotFound {
        GitHubCliError::NotInstalled
    } else {
        GitHubCliError::Io(err)
    }
}

fn command_failure(program: &str, args: &[String], output: CommandOutput) -> GitHubCliError {
    GitHubCliError::CommandFailed {
        program: program.to_string(),
        args: args.to_vec(),
        status: output.status,
        stdout: output.stdout,
        stderr: output.stderr,
    }
}

fn ensure_git_remote_exists(project_path: &Path) -> Result<(), GitHubCliError> {
    let repo =
        Repository::open(project_path).map_err(|err| GitHubCliError::Git(AnyhowError::new(err)))?;
    let remotes = repo
        .remotes()
        .map_err(|err| GitHubCliError::Git(AnyhowError::new(err)))?;
    let has_remote = remotes.iter().flatten().any(|name| !name.trim().is_empty());

    if has_remote {
        Ok(())
    } else {
        Err(GitHubCliError::NoGitRemote)
    }
}

static GH_PROGRAM_CACHE: OnceLock<String> = OnceLock::new();
static GITHUB_CLI_VERSION_LOGGED: OnceLock<()> = OnceLock::new();
static GITHUB_AUTH_LOGGED: OnceLock<()> = OnceLock::new();

fn resolve_github_cli_program() -> String {
    GH_PROGRAM_CACHE
        .get_or_init(resolve_github_cli_program_uncached)
        .clone()
}

fn resolve_github_cli_program_uncached() -> String {
    if let Ok(custom) = env::var("GITHUB_CLI_PATH") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            log::info!("[GitHubCli] Using GITHUB_CLI_PATH override: {trimmed}");
            return trimmed.to_string();
        }
    }

    if let Ok(custom) = env::var("GH_BINARY_PATH") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            log::info!("[GitHubCli] Using GH_BINARY_PATH override: {trimmed}");
            return trimmed.to_string();
        }
    }

    let command = "gh";

    if let Ok(home) = env::var("HOME") {
        let user_paths = [
            format!("{home}/.local/bin"),
            format!("{home}/.cargo/bin"),
            format!("{home}/bin"),
        ];

        for path in &user_paths {
            let full_path = PathBuf::from(path).join(command);
            if full_path.exists() {
                let resolved = full_path.to_string_lossy().to_string();
                log::info!("[GitHubCli] Found gh in user path: {resolved}");
                return resolved;
            }
        }
    }

    let common_paths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

    for path in &common_paths {
        let full_path = PathBuf::from(path).join(command);
        if full_path.exists() {
            let resolved = full_path.to_string_lossy().to_string();
            log::info!("[GitHubCli] Found gh in common path: {resolved}");
            return resolved;
        }
    }

    if let Ok(output) = StdCommand::new("which").arg(command).output() {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let trimmed = path.trim();
                if !trimmed.is_empty() {
                    log::info!("[GitHubCli] Found gh via which: {trimmed}");
                    return trimmed.to_string();
                }
            }
        } else if let Ok(err) = String::from_utf8(output.stderr) {
            warn!("[GitHubCli] 'which gh' failed: {err}");
        }
    }

    warn!("[GitHubCli] Falling back to plain 'gh' - binary may not be found");
    command.to_string()
}

fn combine_output(output: &CommandOutput) -> String {
    if output.stderr.is_empty() {
        output.stdout.clone()
    } else if output.stdout.is_empty() {
        output.stderr.clone()
    } else {
        format!("{}\n{}", output.stdout, output.stderr)
    }
}

fn strip_ansi_codes(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(ch);
        }
    }

    result
}

fn extract_pr_url(text: &str) -> Option<String> {
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| "()[]{}<>,.;".contains(c));
        if cleaned.starts_with("https://github.com/") && cleaned.contains("/pull/") {
            return Some(cleaned.to_string());
        }
    }
    None
}

fn sanitize_branch_component(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut prev_dash = true;

    for ch in input.chars() {
        let normalized = match ch {
            'A'..='Z' => ch.to_ascii_lowercase(),
            'a'..='z' | '0'..='9' => ch,
            '-' | '_' => '-',
            _ => '-',
        };

        if normalized == '-' {
            if prev_dash {
                continue;
            }
            prev_dash = true;
            result.push('-');
        } else {
            prev_dash = false;
            result.push(normalized);
        }
    }

    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() {
        "session".to_string()
    } else {
        trimmed.to_string()
    }
}

fn split_label_filters(query: &str) -> (String, Vec<String>) {
    let mut cleaned = String::with_capacity(query.len());
    let mut labels: Vec<String> = Vec::new();
    let mut index = 0;

    while index < query.len() {
        if let Some((marker_len, is_boundary)) = detect_label_marker(query, index)
            && is_boundary
        {
            let after_marker = index + marker_len;
            let value_start = skip_leading_whitespace(query, after_marker);
            if value_start >= query.len() {
                index = value_start;
                continue;
            }

            let (label_value, value_end) = parse_label_value(query, value_start);
            if let Some(value) = label_value {
                labels.push(value);
                index = skip_leading_whitespace(query, value_end);
                continue;
            }

            index = value_end;
            continue;
        }

        let ch = query[index..].chars().next().unwrap();
        cleaned.push(ch);
        index += ch.len_utf8();
    }

    let normalized = cleaned
        .split_whitespace()
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    (normalized, labels)
}

fn detect_label_marker(query: &str, index: usize) -> Option<(usize, bool)> {
    for marker in ["label:", "label="] {
        let len = marker.len();
        if let Some(candidate) = query[index..].get(..len)
            && candidate.eq_ignore_ascii_case(marker)
        {
            let boundary = index == 0
                || query[..index]
                    .chars()
                    .last()
                    .map(|ch| ch.is_whitespace())
                    .unwrap_or(true);
            return Some((len, boundary));
        }
    }
    None
}

fn skip_leading_whitespace(query: &str, mut index: usize) -> usize {
    while index < query.len() {
        let ch = query[index..].chars().next().unwrap();
        if ch.is_whitespace() {
            index += ch.len_utf8();
        } else {
            break;
        }
    }
    index
}

fn parse_label_value(query: &str, start: usize) -> (Option<String>, usize) {
    if start >= query.len() {
        return (None, start);
    }

    let mut cursor = start;
    let mut iter = query[cursor..].chars();
    let first = iter.next().unwrap();

    if first == '"' || first == '\'' {
        cursor += first.len_utf8();
        let mut value = String::new();
        while cursor < query.len() {
            let ch = query[cursor..].chars().next().unwrap();
            if ch == first {
                cursor += ch.len_utf8();
                break;
            }
            value.push(ch);
            cursor += ch.len_utf8();
        }
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return (None, cursor);
        }
        return (Some(trimmed.to_string()), cursor);
    }

    let mut value = String::new();
    value.push(first);
    cursor += first.len_utf8();
    while cursor < query.len() {
        let ch = query[cursor..].chars().next().unwrap();
        if ch.is_whitespace() {
            break;
        }
        value.push(ch);
        cursor += ch.len_utf8();
    }

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return (None, cursor);
    }

    (Some(trimmed.to_string()), cursor)
}

#[derive(Debug, Deserialize)]
struct RepoViewResponse {
    #[serde(rename = "nameWithOwner")]
    name_with_owner: String,
    #[serde(rename = "defaultBranchRef")]
    default_branch_ref: Option<DefaultBranchRef>,
}

#[derive(Debug, Deserialize)]
struct DefaultBranchRef {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PrViewResponse {
    url: String,
}

#[derive(Debug, Deserialize)]
struct IssueListResponse {
    number: u64,
    title: String,
    state: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    author: Option<IssueActor>,
    #[serde(default)]
    labels: Vec<IssueLabel>,
    url: String,
}

#[derive(Debug, Deserialize)]
struct IssueActor {
    login: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IssueLabel {
    name: String,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IssueDetailsResponse {
    number: u64,
    title: String,
    url: String,
    body: Option<String>,
    #[serde(default)]
    labels: Vec<IssueLabel>,
    comments: Option<IssueComments>,
}

#[derive(Debug, Deserialize)]
struct IssueCommentNode {
    body: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: Option<String>,
    author: Option<IssueActor>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum IssueComments {
    Connection {
        #[serde(default)]
        nodes: Vec<IssueCommentNode>,
    },
    List(Vec<IssueCommentNode>),
    None,
}

#[derive(Debug, Deserialize)]
struct PrListResponse {
    number: u64,
    title: String,
    state: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    author: Option<IssueActor>,
    #[serde(default)]
    labels: Vec<IssueLabel>,
    url: String,
    #[serde(rename = "headRefName")]
    head_ref_name: String,
}

#[derive(Debug, Deserialize)]
struct PrDetailsResponse {
    number: u64,
    title: String,
    url: String,
    body: Option<String>,
    #[serde(default)]
    labels: Vec<IssueLabel>,
    comments: Option<IssueComments>,
    #[serde(rename = "headRefName")]
    head_ref_name: String,
}

#[derive(Debug, Deserialize)]
struct PrReviewCommentResponse {
    id: u64,
    path: String,
    line: Option<u64>,
    original_line: Option<u64>,
    body: String,
    user: Option<IssueActor>,
    created_at: String,
    html_url: String,
    in_reply_to_id: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::io;
    use std::path::PathBuf;
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

    #[test]
    fn ensure_installed_reports_missing_binary() {
        let runner = MockRunner::default();
        runner.push_response(Err(io::Error::new(io::ErrorKind::NotFound, "gh missing")));
        let cli = GitHubCli::with_runner(runner);

        let err = cli.ensure_installed().unwrap_err();
        assert!(matches!(err, GitHubCliError::NotInstalled));
    }

    #[test]
    fn check_auth_parses_login() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "github.com\n  ✓ Logged in to github.com as octocat (https)".to_string(),
            stderr: String::new(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: r#"{"login":"octocat","id":1,"name":"The Octocat"}"#.to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner);

        let status = cli.check_auth().expect("status");
        assert!(status.authenticated);
        assert_eq!(status.user_login.as_deref(), Some("octocat"));
    }

    #[test]
    fn check_auth_handles_unauthenticated() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "You are not logged into any GitHub hosts. Run gh auth login to authenticate."
                .to_string(),
        }));
        let cli = GitHubCli::with_runner(runner);

        let status = cli.check_auth().expect("status");
        assert!(!status.authenticated);
        assert_eq!(status.user_login, None);
    }

    #[test]
    fn search_issues_parses_results_and_builds_arguments() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "\u{1b}[32m[\n  {\"number\":42,\"title\":\"Bug\",\"state\":\"OPEN\",\"updatedAt\":\"2024-01-01T12:00:00Z\",\"author\":{\"login\":\"octocat\"},\"labels\":[{\"name\":\"bug\",\"color\":\"d73a4a\"}],\"url\":\"https://github.com/example/repo/issues/42\"}\n]\u{1b}[0m".to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        repo.remote("origin", "https://github.com/example/repo")
            .unwrap();

        let results = cli
            .search_issues(repo_path, "", 50)
            .expect("issue search results");

        assert_eq!(results.len(), 1);
        let issue = &results[0];
        assert_eq!(issue.number, 42);
        assert_eq!(issue.title, "Bug");
        assert_eq!(issue.state, "OPEN");
        assert_eq!(issue.updated_at, "2024-01-01T12:00:00Z");
        assert_eq!(issue.author_login.as_deref(), Some("octocat"));
        assert_eq!(issue.labels.len(), 1);
        assert_eq!(issue.labels[0].name, "bug");
        assert_eq!(issue.labels[0].color.as_deref(), Some("d73a4a"));
        assert_eq!(issue.url, "https://github.com/example/repo/issues/42");

        let calls = runner.calls();
        assert_eq!(calls.len(), 1);
        let args = calls[0].args.clone();
        assert_eq!(args[0], "issue");
        assert_eq!(args[1], "list");
        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"--limit".to_string()));
        assert!(args.contains(&"--state".to_string()));
        assert!(args.contains(&"open".to_string()));
        assert!(
            !args.contains(&"--search".to_string()),
            "Search flag should be omitted when query is empty"
        );
    }

    #[test]
    fn search_issues_includes_query_and_state_all() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "[{\"number\":7,\"title\":\"Feature\",\"state\":\"OPEN\",\"updatedAt\":\"2024-02-02T00:00:00Z\",\"author\":null,\"labels\":[],\"url\":\"https://github.com/example/repo/issues/7\"}]".to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        repo.remote("origin", "https://github.com/example/repo")
            .unwrap();

        let results = cli
            .search_issues(repo_path, "  regression fix ", 5)
            .expect("issue search results");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].number, 7);

        let args = runner.calls()[0].args.clone();
        assert!(args.contains(&"--search".to_string()));
        assert!(args.contains(&"regression fix".to_string()));
        assert!(args.contains(&"--state".to_string()));
        assert!(args.contains(&"all".to_string()));
    }

    #[test]
    fn search_issues_extracts_label_filters() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "[]".to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        repo.remote("origin", "https://github.com/example/repo")
            .unwrap();

        let _ = cli
            .search_issues(repo_path, "label:\"bug\" critical", 5)
            .expect("issue search results");

        let args = runner.calls()[0].args.clone();
        assert!(args.contains(&"--label".to_string()));
        assert!(args.contains(&"bug".to_string()));
        assert!(args.contains(&"--search".to_string()));
        assert!(args.contains(&"critical".to_string()));
        assert!(
            !args.iter().any(|arg| arg.contains("label:\"bug\"")),
            "label qualifier should be stripped from search text"
        );
    }

    #[test]
    fn search_issues_with_label_only_uses_state_open() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "[]".to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        repo.remote("origin", "https://github.com/example/repo")
            .unwrap();

        let _ = cli
            .search_issues(repo_path, "label:enhancement", 10)
            .expect("issue search results");

        let args = runner.calls()[0].args.clone();
        assert!(args.contains(&"--label".to_string()));
        assert!(args.contains(&"enhancement".to_string()));
        assert!(
            !args.contains(&"--search".to_string()),
            "Search flag should be omitted when only labels are provided"
        );
        let state_index = args
            .iter()
            .position(|arg| arg == "--state")
            .expect("state argument should exist");
        assert_eq!(args[state_index + 1], "open");
    }

    #[test]
    fn search_issues_supports_multiple_label_filters() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "[]".to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        repo.remote("origin", "https://github.com/example/repo")
            .unwrap();

        let _ = cli
            .search_issues(
                repo_path,
                "label:bug label:\"help wanted\" login failure",
                25,
            )
            .expect("issue search results");

        let args = runner.calls()[0].args.clone();
        let label_args: Vec<&String> = args
            .iter()
            .filter(|arg| arg.as_str() == "--label")
            .collect();
        assert_eq!(label_args.len(), 2, "expected two label flags");
        assert!(args.contains(&"bug".to_string()));
        assert!(args.contains(&"help wanted".to_string()));
        assert!(args.contains(&"--search".to_string()));
        assert!(args.contains(&"login failure".to_string()));
        assert!(
            !args.iter().any(|arg| arg.contains("label:")),
            "label tokens should be removed from search query"
        );
    }

    #[test]
    fn search_issues_sorts_results_by_updated_at_desc() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: r#"[{"number":1,"title":"Older","state":"OPEN","updatedAt":"2024-01-01T00:00:00Z","author":null,"labels":[],"url":"https://example.com/1"},{"number":2,"title":"Newer","state":"OPEN","updatedAt":"2024-01-02T00:00:00Z","author":null,"labels":[],"url":"https://example.com/2"}]"#.to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        repo.remote("origin", "https://github.com/example/repo")
            .unwrap();

        let results = cli
            .search_issues(repo_path, "", 20)
            .expect("issue search results");

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].number, 2);
        assert_eq!(results[1].number, 1);
    }

    #[test]
    fn get_issue_with_comments_parses_body_and_comments() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json!({
                "number": 101,
                "title": "Broken flow",
                "url": "https://github.com/example/repo/issues/101",
                "body": "Steps to reproduce",
                "labels": [
                    { "name": "bug", "color": "d73a4a" },
                    { "name": "priority:high", "color": "b60205" }
                ],
                "comments": {
                    "nodes": [
                        {
                            "author": { "login": "octocat" },
                            "createdAt": "2024-03-01T10:00:00Z",
                            "body": "Can confirm"
                        },
                        {
                            "author": { "login": "hubot" },
                            "createdAt": "2024-03-01T11:00:00Z",
                            "body": "Working on a fix"
                        }
                    ]
                }
            })
            .to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        repo.remote("origin", "https://github.com/example/repo")
            .unwrap();

        let details = cli
            .get_issue_with_comments(repo_path, 101)
            .expect("issue details");

        assert_eq!(details.number, 101);
        assert_eq!(details.title, "Broken flow");
        assert_eq!(details.url, "https://github.com/example/repo/issues/101");
        assert_eq!(details.body, "Steps to reproduce");
        assert_eq!(details.labels.len(), 2);
        assert_eq!(details.labels[0].name, "bug");
        assert_eq!(details.comments.len(), 2);
        assert_eq!(details.comments[0].author_login.as_deref(), Some("octocat"));
        assert_eq!(details.comments[0].created_at, "2024-03-01T10:00:00Z");
        assert_eq!(details.comments[0].body, "Can confirm");
        assert_eq!(details.comments[1].author_login.as_deref(), Some("hubot"));

        let args = runner.calls()[0].args.clone();
        assert_eq!(args[0], "issue");
        assert_eq!(args[1], "view");
        assert!(args.contains(&"101".to_string()));
        assert!(args.contains(&"--json".to_string()));
    }

    #[test]
    fn get_issue_with_comments_handles_array_response() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json!({
                "number": 5,
                "title": "Array comments",
                "url": "https://github.com/example/repo/issues/5",
                "body": "Body",
                "labels": [],
                "comments": [
                    {
                        "author": { "login": "octocat" },
                        "createdAt": "2024-01-01T00:00:00Z",
                        "body": "First array comment"
                    }
                ]
            })
            .to_string(),
            stderr: String::new(),
        }));
        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        repo.remote("origin", "https://github.com/example/repo")
            .unwrap();

        let details = cli
            .get_issue_with_comments(repo_path, 5)
            .expect("issue details");

        assert_eq!(details.comments.len(), 1);
        assert_eq!(details.comments[0].author_login.as_deref(), Some("octocat"));
        assert_eq!(details.comments[0].body, "First array comment");
    }

    #[test]
    fn create_pr_creates_branch_and_returns_url() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "https://github.com/owner/repo/pull/42".to_string(),
            stderr: String::new(),
        }));

        let cli = GitHubCli::with_runner(runner);

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Tester").unwrap();
            config.set_str("user.email", "tester@example.com").unwrap();
        }
        std::fs::write(repo_path.join("README.md"), "hello").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = repo.signature().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
        let head_ref = repo.head().unwrap();
        let head_commit = head_ref.peel_to_commit().unwrap();
        if head_ref
            .name()
            .map(|name| name != "refs/heads/main")
            .unwrap_or(true)
        {
            repo.branch("main", &head_commit, true).unwrap();
            repo.set_head("refs/heads/main").unwrap();
        }
        repo.checkout_head(Some(
            git2::build::CheckoutBuilder::new()
                .force()
                .remove_untracked(true),
        ))
        .unwrap();

        std::fs::write(repo_path.join("feature.txt"), "change").unwrap();

        let opts = CreatePrOptions {
            repo_path,
            worktree_path: repo_path,
            session_slug: "session-demo",
            default_branch: "main",
            commit_message: Some("feat: demo"),
            repository: Some("owner/repo"),
        };

        let result = cli.create_pr_from_worktree(opts).expect("pr result");
        assert_eq!(result.branch, "reviewed/session-demo");
        assert_eq!(result.url, "https://github.com/owner/repo/pull/42");
    }

    #[test]
    fn create_pr_fetches_url_when_web_flag_used() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "Opening github.com/owner/repo/pull/42 in your browser.".to_string(),
            stderr: String::new(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json!({ "url": "https://github.com/owner/repo/pull/42" }).to_string(),
            stderr: String::new(),
        }));

        let cli = GitHubCli::with_runner(runner);

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Tester").unwrap();
            config.set_str("user.email", "tester@example.com").unwrap();
        }
        std::fs::write(repo_path.join("README.md"), "hello").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = repo.signature().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
        let head_ref = repo.head().unwrap();
        let head_commit = head_ref.peel_to_commit().unwrap();
        if head_ref
            .name()
            .map(|name| name != "refs/heads/main")
            .unwrap_or(true)
        {
            repo.branch("main", &head_commit, true).unwrap();
            repo.set_head("refs/heads/main").unwrap();
        }
        repo.checkout_head(Some(
            git2::build::CheckoutBuilder::new()
                .force()
                .remove_untracked(true),
        ))
        .unwrap();

        std::fs::write(repo_path.join("feature.txt"), "change").unwrap();

        let opts = CreatePrOptions {
            repo_path,
            worktree_path: repo_path,
            session_slug: "session-demo",
            default_branch: "main",
            commit_message: Some("feat: demo"),
            repository: Some("owner/repo"),
        };

        let result = cli.create_pr_from_worktree(opts).expect("pr result");
        assert_eq!(result.branch, "reviewed/session-demo");
        assert_eq!(result.url, "");
    }

    #[test]
    fn create_pr_returns_existing_url_when_pr_exists() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "GraphQL: A pull request already exists".to_string(),
        }));
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json!({ "url": "https://github.com/owner/repo/pull/99" }).to_string(),
            stderr: String::new(),
        }));

        let cli = GitHubCli::with_runner(runner.clone());

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();
        let repo = git2::Repository::init(repo_path).unwrap();
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Tester").unwrap();
            config.set_str("user.email", "tester@example.com").unwrap();
        }
        std::fs::write(repo_path.join("README.md"), "hello").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = repo.signature().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
        let head_ref = repo.head().unwrap();
        let head_commit = head_ref.peel_to_commit().unwrap();
        if head_ref
            .name()
            .map(|name| name != "refs/heads/main")
            .unwrap_or(true)
        {
            repo.branch("main", &head_commit, true).unwrap();
            repo.set_head("refs/heads/main").unwrap();
        }
        repo.checkout_head(Some(
            git2::build::CheckoutBuilder::new()
                .force()
                .remove_untracked(true),
        ))
        .unwrap();

        std::fs::write(repo_path.join("feature.txt"), "change").unwrap();

        let opts = CreatePrOptions {
            repo_path,
            worktree_path: repo_path,
            session_slug: "session-demo",
            default_branch: "main",
            commit_message: Some("feat: demo"),
            repository: Some("owner/repo"),
        };

        let result = cli.create_pr_from_worktree(opts).expect("pr result");
        assert_eq!(result.branch, "reviewed/session-demo");
        assert_eq!(result.url, "https://github.com/owner/repo/pull/99");

        let calls = runner.calls();
        let gh_calls = calls
            .into_iter()
            .filter(|call| call.program == "gh")
            .collect::<Vec<_>>();
        assert_eq!(gh_calls.len(), 2);
        assert_eq!(
            gh_calls[1].args,
            vec![
                "pr".to_string(),
                "view".to_string(),
                "reviewed/session-demo".to_string(),
                "--json".to_string(),
                "url".to_string(),
                "--repo".to_string(),
                "owner/repo".to_string(),
            ]
        );
    }

    #[test]
    fn sanitize_branch_component_squashes_invalid_chars() {
        assert_eq!(sanitize_branch_component("My Session #1"), "my-session-1");
        assert_eq!(sanitize_branch_component("***"), "session");
        assert_eq!(sanitize_branch_component("Mixed_CASE"), "mixed-case");
    }

    #[test]
    fn strip_ansi_codes_removes_color_codes() {
        let colored = "\x1b[1;38m{\x1b[m\n  \x1b[1;34m\"login\"\x1b[m\x1b[1;38m:\x1b[m \x1b[32m\"octocat\"\x1b[m\n\x1b[1;38m}\x1b[m";
        let stripped = strip_ansi_codes(colored);
        assert_eq!(stripped, "{\n  \"login\": \"octocat\"\n}");

        let plain = "{\"login\":\"octocat\"}";
        assert_eq!(strip_ansi_codes(plain), plain);
    }

    #[test]
    fn authenticate_returns_user_instructions() {
        let runner = MockRunner::default();
        let cli = GitHubCli::with_runner(runner.clone());

        let result = cli.authenticate();
        assert!(result.is_err());

        let err = result.unwrap_err();
        match err {
            GitHubCliError::CommandFailed { stderr, .. } => {
                assert!(stderr.contains("gh auth login"));
                assert!(stderr.contains("terminal"));
            }
            _ => panic!("Expected CommandFailed error"),
        }

        let calls = runner.calls();
        assert_eq!(calls.len(), 0);
    }
}

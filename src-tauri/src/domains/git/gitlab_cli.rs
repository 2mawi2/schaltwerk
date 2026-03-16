use std::env;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use log::{debug, info, warn};
use serde::{Deserialize, Serialize};

use super::github_cli::{CommandRunner, SystemCommandRunner};
use super::operations::has_uncommitted_changes;
use super::strip_ansi_codes;

#[derive(Debug)]
pub enum GitlabCliError {
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
    InvalidInput(String),
    InvalidOutput(String),
}

impl std::fmt::Display for GitlabCliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitlabCliError::NotInstalled => write!(f, "GitLab CLI (glab) is not installed."),
            GitlabCliError::NoGitRemote => {
                write!(f, "No Git remotes configured for this repository.")
            }
            GitlabCliError::CommandFailed {
                program,
                status,
                stderr,
                ..
            } => write!(
                f,
                "Command `{program}` failed with status {status:?}: {stderr}"
            ),
            GitlabCliError::Io(err) => write!(f, "IO error: {err}"),
            GitlabCliError::Json(err) => write!(f, "JSON error: {err}"),
            GitlabCliError::Git(err) => write!(f, "Git error: {err}"),
            GitlabCliError::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            GitlabCliError::InvalidOutput(msg) => write!(f, "Invalid CLI output: {msg}"),
        }
    }
}

impl std::error::Error for GitlabCliError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            GitlabCliError::Io(err) => Some(err),
            GitlabCliError::Json(err) => Some(err),
            GitlabCliError::Git(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<serde_json::Error> for GitlabCliError {
    fn from(value: serde_json::Error) -> Self {
        GitlabCliError::Json(value)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GitlabAuthStatus {
    pub authenticated: bool,
    pub hostname: Option<String>,
    pub user_login: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabUser {
    pub username: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabNote {
    pub author: Option<GitlabUser>,
    pub created_at: String,
    pub body: String,
    #[serde(default)]
    pub system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabIssueSummary {
    pub iid: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<GitlabUser>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub web_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabIssueDetails {
    pub iid: u64,
    pub title: String,
    pub web_url: String,
    pub description: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub state: String,
    pub author: Option<GitlabUser>,
    #[serde(default)]
    pub notes: Vec<GitlabNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabPipelineSummary {
    pub id: u64,
    pub status: String,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabMrSummary {
    pub iid: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<GitlabUser>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub web_url: String,
    pub source_branch: String,
    pub target_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabMrDetails {
    pub iid: u64,
    pub title: String,
    pub web_url: String,
    pub description: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub state: String,
    pub source_branch: String,
    pub target_branch: String,
    pub author: Option<GitlabUser>,
    pub merge_status: Option<String>,
    pub pipeline: Option<GitlabPipelineSummary>,
    #[serde(default)]
    pub notes: Vec<GitlabNote>,
    #[serde(default)]
    pub reviewers: Vec<GitlabUser>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitlabMrResult {
    pub source_branch: String,
    pub url: String,
}

pub struct CreateMrParams<'a> {
    pub project_path: &'a Path,
    pub gitlab_project: &'a str,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub source_branch: &'a str,
    pub target_branch: &'a str,
    pub hostname: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MrCommitMode {
    Squash,
    Reapply,
}

impl MrCommitMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            MrCommitMode::Squash => "squash",
            MrCommitMode::Reapply => "reapply",
        }
    }
}

pub struct CreateSessionMrOptions<'a> {
    pub repo_path: &'a Path,
    pub session_worktree_path: &'a Path,
    pub session_slug: &'a str,
    pub session_branch: &'a str,
    pub base_branch: &'a str,
    pub mr_branch_name: &'a str,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub gitlab_project: &'a str,
    pub hostname: Option<&'a str>,
    pub squash: bool,
    pub mode: MrCommitMode,
    pub commit_message: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabPipelineDetails {
    pub id: u64,
    pub status: String,
    pub web_url: Option<String>,
    pub source: Option<String>,
    pub duration: Option<f64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

pub struct GitlabCli<R: CommandRunner = SystemCommandRunner> {
    runner: R,
    program: String,
}

impl GitlabCli<SystemCommandRunner> {
    pub fn new() -> Self {
        Self {
            runner: SystemCommandRunner,
            program: resolve_gitlab_cli_program(),
        }
    }
}

impl Default for GitlabCli<SystemCommandRunner> {
    fn default() -> Self {
        Self::new()
    }
}

impl<R: CommandRunner> GitlabCli<R> {
    pub fn with_runner(runner: R) -> Self {
        Self {
            runner,
            program: "glab".to_string(),
        }
    }

    pub fn ensure_installed(&self) -> Result<(), GitlabCliError> {
        debug!(
            "[GitlabCli] Checking if GitLab CLI is installed: program='{}', PATH={}",
            self.program,
            std::env::var("PATH").unwrap_or_else(|_| "<not set>".to_string())
        );
        match self.runner.run(&self.program, &["--version"], None, &[]) {
            Ok(output) => {
                if output.success() {
                    if GITLAB_CLI_VERSION_LOGGED.set(()).is_ok() {
                        info!("GitLab CLI detected: {}", output.stdout.trim());
                    } else {
                        debug!("GitLab CLI detected: {}", output.stdout.trim());
                    }
                    Ok(())
                } else {
                    debug!(
                        "GitLab CLI version command failed with status {:?}: stdout={}, stderr={}",
                        output.status, output.stdout, output.stderr
                    );
                    Err(GitlabCliError::NotInstalled)
                }
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                debug!("GitLab CLI binary not found at '{}'", self.program);
                Err(GitlabCliError::NotInstalled)
            }
            Err(err) => {
                debug!("GitLab CLI check failed with IO error: {err}");
                Err(GitlabCliError::Io(err))
            }
        }
    }

    pub fn check_auth(
        &self,
        hostname: Option<&str>,
    ) -> Result<GitlabAuthStatus, GitlabCliError> {
        let env = [("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        let mut args_vec = vec!["auth".to_string(), "status".to_string()];
        if let Some(host) = hostname {
            args_vec.push("--hostname".to_string());
            args_vec.push(host.to_string());
        }

        debug!("[GitlabCli] Running glab auth status check");
        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, None, &env)
            .map_err(map_runner_error)?;

        debug!(
            "[GitlabCli] glab auth status result: exit={:?}, stdout_len={}, stderr_len={}",
            output.status,
            output.stdout.len(),
            output.stderr.len()
        );

        if !output.success() {
            debug!("[GitlabCli] glab auth status indicates unauthenticated");
            return Ok(GitlabAuthStatus {
                authenticated: false,
                hostname: None,
                user_login: None,
            });
        }

        let combined = format!("{}\n{}", output.stdout, output.stderr);
        let clean = strip_ansi_codes(&combined);

        let mut parsed_hostname: Option<String> = None;
        let mut parsed_user: Option<String> = None;

        for line in clean.lines() {
            let trimmed = line.trim();
            if trimmed.contains("Logged in to")
                && trimmed.contains(" as ")
                && let Some(after_to) = trimmed.split("Logged in to ").nth(1)
            {
                if let Some(host_part) = after_to.split(" as ").next() {
                    parsed_hostname = Some(host_part.trim().to_string());
                }
                if let Some(after_as) = after_to.split(" as ").nth(1) {
                    let user = after_as
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if !user.is_empty() {
                        parsed_user = Some(user);
                    }
                }
            }
        }

        info!(
            "[GitlabCli] Authentication verified: hostname={parsed_hostname:?}, user={parsed_user:?}"
        );

        Ok(GitlabAuthStatus {
            authenticated: true,
            hostname: parsed_hostname,
            user_login: parsed_user,
        })
    }

    pub fn search_issues(
        &self,
        project_path: &Path,
        query: &str,
        limit: usize,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<Vec<GitlabIssueSummary>, GitlabCliError> {
        debug!(
            "[GitlabCli] Searching issues: project={}, query='{}', limit={}",
            project_path.display(),
            query,
            limit
        );

        let constrained_limit = limit.clamp(1, 100);
        let trimmed_query = query.trim();

        let mut args_vec = vec![
            "issue".to_string(),
            "list".to_string(),
            "--output".to_string(),
            "json".to_string(),
            "--per-page".to_string(),
            constrained_limit.to_string(),
            "-R".to_string(),
            gitlab_project.to_string(),
        ];

        if !trimmed_query.is_empty() {
            args_vec.push("--search".to_string());
            args_vec.push(trimmed_query.to_string());
        }

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env_vec)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let trimmed = clean_output.trim();

        if trimmed.is_empty() || trimmed == "null" || trimmed == "[]" {
            return Ok(Vec::new());
        }

        let issues: Vec<GitlabIssueSummary> =
            serde_json::from_str(trimmed).map_err(|err| {
                log::error!(
                    "[GitlabCli] Failed to parse issue search response: {err}; raw={trimmed}"
                );
                GitlabCliError::InvalidOutput(
                    "GitLab CLI returned issue data in an unexpected format.".to_string(),
                )
            })?;

        Ok(issues)
    }

    pub fn get_issue_details(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<GitlabIssueDetails, GitlabCliError> {
        debug!(
            "[GitlabCli] Fetching issue details: project={}, iid={}",
            project_path.display(),
            iid
        );

        let args_vec = vec![
            "issue".to_string(),
            "view".to_string(),
            iid.to_string(),
            "--output".to_string(),
            "json".to_string(),
            "--comments".to_string(),
            "-R".to_string(),
            gitlab_project.to_string(),
        ];

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env_vec)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let details: GitlabIssueDetails =
            serde_json::from_str(clean_output.trim()).map_err(|err| {
                log::error!(
                    "[GitlabCli] Failed to parse issue detail response: {err}; raw={}",
                    clean_output.trim()
                );
                GitlabCliError::InvalidOutput(
                    "GitLab CLI returned issue detail data in an unexpected format."
                        .to_string(),
                )
            })?;

        Ok(details)
    }

    pub fn search_mrs(
        &self,
        project_path: &Path,
        query: &str,
        limit: usize,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<Vec<GitlabMrSummary>, GitlabCliError> {
        debug!(
            "[GitlabCli] Searching MRs: project={}, query='{}', limit={}",
            project_path.display(),
            query,
            limit
        );

        let constrained_limit = limit.clamp(1, 100);
        let trimmed_query = query.trim();

        let mut args_vec = vec![
            "mr".to_string(),
            "list".to_string(),
            "--output".to_string(),
            "json".to_string(),
            "--per-page".to_string(),
            constrained_limit.to_string(),
            "-R".to_string(),
            gitlab_project.to_string(),
        ];

        if !trimmed_query.is_empty() {
            args_vec.push("--search".to_string());
            args_vec.push(trimmed_query.to_string());
        }

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env_vec)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let trimmed = clean_output.trim();

        if trimmed.is_empty() || trimmed == "null" || trimmed == "[]" {
            return Ok(Vec::new());
        }

        let mrs: Vec<GitlabMrSummary> =
            serde_json::from_str(trimmed).map_err(|err| {
                log::error!(
                    "[GitlabCli] Failed to parse MR search response: {err}; raw={trimmed}"
                );
                GitlabCliError::InvalidOutput(
                    "GitLab CLI returned MR data in an unexpected format.".to_string(),
                )
            })?;

        Ok(mrs)
    }

    pub fn get_mr_details(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<GitlabMrDetails, GitlabCliError> {
        debug!(
            "[GitlabCli] Fetching MR details: project={}, iid={}",
            project_path.display(),
            iid
        );

        let args_vec = vec![
            "mr".to_string(),
            "view".to_string(),
            iid.to_string(),
            "--output".to_string(),
            "json".to_string(),
            "--comments".to_string(),
            "-R".to_string(),
            gitlab_project.to_string(),
        ];

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env_vec)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let details: GitlabMrDetails =
            serde_json::from_str(clean_output.trim()).map_err(|err| {
                log::error!(
                    "[GitlabCli] Failed to parse MR detail response: {err}; raw={}",
                    clean_output.trim()
                );
                GitlabCliError::InvalidOutput(
                    "GitLab CLI returned MR detail data in an unexpected format."
                        .to_string(),
                )
            })?;

        Ok(details)
    }

    pub fn get_mr_pipeline_status(
        &self,
        project_path: &Path,
        branch: &str,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<Option<GitlabPipelineDetails>, GitlabCliError> {
        debug!(
            "[GitlabCli] Fetching pipeline status: project={}, branch={}",
            project_path.display(),
            branch
        );

        let branch_str = branch.to_string();
        let project_str = gitlab_project.to_string();
        let args_arr = [
            "ci", "get", "--branch", &branch_str, "--output", "json", "-R", &project_str,
        ];

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let output = self
            .runner
            .run(&self.program, &args_arr, Some(project_path), &env_vec)
            .map_err(map_runner_error)?;

        if !output.success() {
            debug!(
                "[GitlabCli] Pipeline status command failed (pipeline may not exist): stderr={}",
                output.stderr
            );
            return Ok(None);
        }

        let clean_output = strip_ansi_codes(&output.stdout);
        let trimmed = clean_output.trim();

        if trimmed.is_empty() || trimmed == "null" {
            return Ok(None);
        }

        let pipeline: GitlabPipelineDetails =
            serde_json::from_str(trimmed).map_err(|err| {
                log::error!(
                    "[GitlabCli] Failed to parse pipeline response: {err}; raw={trimmed}"
                );
                GitlabCliError::InvalidOutput(
                    "GitLab CLI returned pipeline data in an unexpected format."
                        .to_string(),
                )
            })?;

        Ok(Some(pipeline))
    }

    pub fn create_mr(&self, params: CreateMrParams<'_>) -> Result<GitlabMrResult, GitlabCliError> {
        debug!(
            "[GitlabCli] Creating MR: project={}, source={}, target={}",
            params.project_path.display(),
            params.source_branch,
            params.target_branch
        );

        let mut args_vec = vec![
            "mr".to_string(),
            "create".to_string(),
            "-t".to_string(),
            params.title.to_string(),
            "-s".to_string(),
            params.source_branch.to_string(),
            "-b".to_string(),
            params.target_branch.to_string(),
            "-R".to_string(),
            params.gitlab_project.to_string(),
            "--yes".to_string(),
            "--no-editor".to_string(),
        ];

        if let Some(desc) = params.description {
            args_vec.push("-d".to_string());
            args_vec.push(desc.to_string());
        }

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = params.hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(
                &self.program,
                &arg_refs,
                Some(params.project_path),
                &env_vec,
            )
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let combined = format!("{}\n{}", output.stdout, output.stderr);
        let url = extract_mr_url(&combined).ok_or_else(|| {
            GitlabCliError::InvalidOutput(
                "Could not extract merge request URL from glab output.".to_string(),
            )
        })?;

        info!("[GitlabCli] MR created: {url}");

        Ok(GitlabMrResult {
            source_branch: params.source_branch.to_string(),
            url,
        })
    }

    pub fn approve_mr(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<(), GitlabCliError> {
        debug!(
            "[GitlabCli] Approving MR: project={}, iid={}",
            project_path.display(),
            iid
        );

        let args_vec = vec![
            "mr".to_string(),
            "approve".to_string(),
            iid.to_string(),
            "-R".to_string(),
            gitlab_project.to_string(),
        ];

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env_vec)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        info!("[GitlabCli] MR {iid} approved");
        Ok(())
    }

    pub fn merge_mr(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        squash: bool,
        remove_source_branch: bool,
        hostname: Option<&str>,
    ) -> Result<(), GitlabCliError> {
        debug!(
            "[GitlabCli] Merging MR: project={}, iid={}, squash={}, remove_source={}",
            project_path.display(),
            iid,
            squash,
            remove_source_branch
        );

        let mut args_vec = vec![
            "mr".to_string(),
            "merge".to_string(),
            iid.to_string(),
            "-R".to_string(),
            gitlab_project.to_string(),
            "--yes".to_string(),
        ];

        if squash {
            args_vec.push("--squash".to_string());
        }
        if remove_source_branch {
            args_vec.push("-d".to_string());
        }

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env_vec)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        info!("[GitlabCli] MR {iid} merged");
        Ok(())
    }

    pub fn comment_on_mr(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        message: &str,
        hostname: Option<&str>,
    ) -> Result<(), GitlabCliError> {
        debug!(
            "[GitlabCli] Commenting on MR: project={}, iid={}",
            project_path.display(),
            iid
        );

        let args_vec = vec![
            "mr".to_string(),
            "note".to_string(),
            iid.to_string(),
            "-m".to_string(),
            message.to_string(),
            "-R".to_string(),
            gitlab_project.to_string(),
        ];

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(&self.program, &arg_refs, Some(project_path), &env_vec)
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        info!("[GitlabCli] Comment added to MR {iid}");
        Ok(())
    }

    pub fn create_session_mr(
        &self,
        opts: CreateSessionMrOptions<'_>,
    ) -> Result<GitlabMrResult, GitlabCliError> {
        info!(
            "[GitlabCli] Creating session MR for '{}' (mode={})",
            opts.session_slug,
            opts.mode.as_str()
        );

        ensure_git_remote(&self.runner, opts.repo_path)?;

        let commit_msg = opts
            .commit_message
            .map(|m| m.trim())
            .filter(|m| !m.is_empty())
            .unwrap_or(opts.title.trim());

        match opts.mode {
            MrCommitMode::Squash => {
                if commit_msg.is_empty() {
                    return Err(GitlabCliError::InvalidInput(
                        "Commit message is required for squash mode.".to_string(),
                    ));
                }

                let merge_base =
                    resolve_merge_base(&self.runner, opts.session_worktree_path, opts.base_branch)?;

                run_git_cmd(
                    &self.runner,
                    opts.session_worktree_path,
                    &["reset".to_string(), "--soft".to_string(), merge_base],
                    &[],
                )?;

                run_git_cmd(
                    &self.runner,
                    opts.session_worktree_path,
                    &["add".to_string(), "-A".to_string()],
                    &[],
                )?;

                run_git_cmd(
                    &self.runner,
                    opts.session_worktree_path,
                    &[
                        "commit".to_string(),
                        "--no-verify".to_string(),
                        "-m".to_string(),
                        commit_msg.to_string(),
                    ],
                    &[],
                )?;
            }
            MrCommitMode::Reapply => {
                let has_uncommitted = has_uncommitted_changes(opts.session_worktree_path)
                    .map_err(GitlabCliError::Git)?;

                if has_uncommitted {
                    if commit_msg.is_empty() {
                        return Err(GitlabCliError::InvalidInput(
                            "Commit message is required when committing uncommitted changes."
                                .to_string(),
                        ));
                    }

                    run_git_cmd(
                        &self.runner,
                        opts.session_worktree_path,
                        &["add".to_string(), "-A".to_string()],
                        &[],
                    )?;

                    run_git_cmd(
                        &self.runner,
                        opts.session_worktree_path,
                        &[
                            "commit".to_string(),
                            "--no-verify".to_string(),
                            "-m".to_string(),
                            commit_msg.to_string(),
                        ],
                        &[],
                    )?;
                }
            }
        }

        if let Err(push_err) =
            push_head_to_remote_branch(&self.runner, opts.session_worktree_path, opts.mr_branch_name)
        {
            let err_str = push_err.to_string();
            if err_str.contains("non-fast-forward") || err_str.contains("[rejected]") {
                return Err(GitlabCliError::InvalidInput(format!(
                    "[rejected] Branch '{}' already exists on remote with different commits (non-fast-forward).",
                    opts.mr_branch_name
                )));
            }
            return Err(push_err);
        }

        if let Err(e) =
            set_upstream_tracking(&self.runner, opts.session_worktree_path, opts.mr_branch_name)
        {
            warn!(
                "[GitlabCli] Failed to set upstream tracking for '{}': {e}",
                opts.mr_branch_name
            );
        }

        let mut args_vec = vec![
            "mr".to_string(),
            "create".to_string(),
            "-t".to_string(),
            opts.title.to_string(),
            "-b".to_string(),
            opts.base_branch.to_string(),
            "-s".to_string(),
            opts.mr_branch_name.to_string(),
            "-R".to_string(),
            opts.gitlab_project.to_string(),
            "--yes".to_string(),
            "--no-editor".to_string(),
        ];

        if let Some(desc) = opts.description {
            args_vec.push("-d".to_string());
            args_vec.push(desc.to_string());
        }

        if opts.squash {
            let squash_msg = opts
                .commit_message
                .unwrap_or(opts.title)
                .trim();
            if !squash_msg.is_empty() {
                args_vec.push("--squash-message-body".to_string());
                args_vec.push(squash_msg.to_string());
            }
        }

        let mut env_vec: Vec<(&str, &str)> =
            vec![("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
        if let Some(host) = opts.hostname {
            env_vec.push(("GITLAB_HOST", host));
        }

        let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
        let output = self
            .runner
            .run(
                &self.program,
                &arg_refs,
                Some(opts.session_worktree_path),
                &env_vec,
            )
            .map_err(map_runner_error)?;

        if !output.success() {
            return Err(command_failure(&self.program, &args_vec, output));
        }

        let combined = format!("{}\n{}", output.stdout, output.stderr);
        let url = extract_mr_url(&combined).ok_or_else(|| {
            GitlabCliError::InvalidOutput(
                "Could not extract merge request URL from glab output.".to_string(),
            )
        })?;

        info!("[GitlabCli] Session MR created: {url}");

        Ok(GitlabMrResult {
            source_branch: opts.mr_branch_name.to_string(),
            url,
        })
    }
}

fn extract_mr_url(text: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("https://") && trimmed.contains("/-/merge_requests/") {
            return Some(trimmed.to_string());
        }
    }
    None
}

fn run_git_cmd<R: CommandRunner>(
    runner: &R,
    cwd: &Path,
    args: &[String],
    extra_env: &[(&str, &str)],
) -> Result<super::github_cli::CommandOutput, GitlabCliError> {
    let env_base = [("GIT_TERMINAL_PROMPT", "0")];
    let mut env = Vec::with_capacity(env_base.len() + extra_env.len());
    env.extend_from_slice(&env_base);
    env.extend_from_slice(extra_env);

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = runner
        .run("git", &arg_refs, Some(cwd), &env)
        .map_err(map_runner_error)?;
    if output.success() {
        return Ok(output);
    }
    Err(command_failure("git", args, output))
}

fn resolve_merge_base<R: CommandRunner>(
    runner: &R,
    worktree_path: &Path,
    base_branch: &str,
) -> Result<String, GitlabCliError> {
    let origin_ref = format!("origin/{base_branch}");
    let attempt_origin_args = vec![
        "merge-base".to_string(),
        "HEAD".to_string(),
        origin_ref,
    ];
    if let Ok(output) = run_git_cmd(runner, worktree_path, &attempt_origin_args, &[]) {
        let mb = output.stdout.trim().to_string();
        if !mb.is_empty() {
            return Ok(mb);
        }
    }

    let attempt_local_args = vec![
        "merge-base".to_string(),
        "HEAD".to_string(),
        base_branch.to_string(),
    ];
    let output = run_git_cmd(runner, worktree_path, &attempt_local_args, &[])?;
    let mb = output.stdout.trim().to_string();
    if mb.is_empty() {
        return Err(GitlabCliError::InvalidOutput(format!(
            "Could not compute merge-base for base branch '{base_branch}'"
        )));
    }
    Ok(mb)
}

fn push_head_to_remote_branch<R: CommandRunner>(
    runner: &R,
    worktree_path: &Path,
    remote_branch: &str,
) -> Result<(), GitlabCliError> {
    let push_refspec = format!("HEAD:refs/heads/{remote_branch}");
    let args = vec![
        "push".to_string(),
        "--no-verify".to_string(),
        "origin".to_string(),
        push_refspec,
    ];
    run_git_cmd(runner, worktree_path, &args, &[])?;
    debug!("Pushed HEAD to remote branch '{remote_branch}'");
    Ok(())
}

fn set_upstream_tracking<R: CommandRunner>(
    runner: &R,
    worktree_path: &Path,
    branch_name: &str,
) -> Result<(), GitlabCliError> {
    let upstream = format!("origin/{branch_name}");
    let args = vec![
        "branch".to_string(),
        "--set-upstream-to".to_string(),
        upstream,
    ];
    run_git_cmd(runner, worktree_path, &args, &[])?;
    debug!("Set upstream tracking to origin/{branch_name}");
    Ok(())
}

fn ensure_git_remote<R: CommandRunner>(
    runner: &R,
    project_path: &Path,
) -> Result<(), GitlabCliError> {
    let args = vec!["remote".to_string()];
    let output = run_git_cmd(runner, project_path, &args, &[])?;
    let has_remote = output.stdout.lines().any(|line| !line.trim().is_empty());
    if has_remote {
        Ok(())
    } else {
        Err(GitlabCliError::NoGitRemote)
    }
}

pub fn map_runner_error(err: io::Error) -> GitlabCliError {
    if err.kind() == io::ErrorKind::NotFound {
        GitlabCliError::NotInstalled
    } else {
        GitlabCliError::Io(err)
    }
}

pub fn command_failure(
    program: &str,
    args: &[String],
    output: super::github_cli::CommandOutput,
) -> GitlabCliError {
    GitlabCliError::CommandFailed {
        program: program.to_string(),
        args: args.to_vec(),
        status: output.status,
        stdout: output.stdout,
        stderr: output.stderr,
    }
}

pub fn format_cli_error(err: GitlabCliError) -> String {
    match err {
        GitlabCliError::NotInstalled => {
            #[cfg(target_os = "macos")]
            {
                "GitLab CLI (glab) is not installed. Install it via `brew install glab`.".to_string()
            }
            #[cfg(target_os = "windows")]
            {
                "GitLab CLI (glab) is not installed. Install it via `scoop install glab` or `winget install GLab.GLab`.".to_string()
            }
            #[cfg(target_os = "linux")]
            {
                "GitLab CLI (glab) is not installed. See https://gitlab.com/gitlab-org/cli#installation".to_string()
            }
        }
        GitlabCliError::CommandFailed {
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
        GitlabCliError::Io(err) => err.to_string(),
        GitlabCliError::Json(err) => format!("Failed to parse GitLab CLI response: {err}"),
        GitlabCliError::Git(err) => format!("Git operation failed: {err}"),
        GitlabCliError::InvalidInput(msg) => msg,
        GitlabCliError::InvalidOutput(msg) => msg,
        GitlabCliError::NoGitRemote => {
            "No Git remotes configured for this project. Add a remote (e.g. `git remote add origin ...`) and try again.".to_string()
        }
    }
}

static GLAB_PROGRAM_CACHE: OnceLock<String> = OnceLock::new();
static GITLAB_CLI_VERSION_LOGGED: OnceLock<()> = OnceLock::new();

fn resolve_gitlab_cli_program() -> String {
    GLAB_PROGRAM_CACHE
        .get_or_init(resolve_gitlab_cli_program_uncached)
        .clone()
}

fn resolve_gitlab_cli_program_uncached() -> String {
    if let Ok(custom) = env::var("GITLAB_CLI_PATH") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            log::info!("[GitlabCli] Using GITLAB_CLI_PATH override: {trimmed}");
            return trimmed.to_string();
        }
    }

    if let Ok(custom) = env::var("GLAB_BINARY_PATH") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            log::info!("[GitlabCli] Using GLAB_BINARY_PATH override: {trimmed}");
            return trimmed.to_string();
        }
    }

    let command = "glab";

    #[cfg(unix)]
    {
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
                    log::info!("[GitlabCli] Found glab in user path: {resolved}");
                    return resolved;
                }
            }
        }

        let common_paths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

        for path in &common_paths {
            let full_path = PathBuf::from(path).join(command);
            if full_path.exists() {
                let resolved = full_path.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in common path: {resolved}");
                return resolved;
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(program_files) = env::var("ProgramFiles") {
            let glab_path = PathBuf::from(&program_files).join("glab").join("glab.exe");
            if glab_path.exists() {
                let resolved = glab_path.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in Program Files: {resolved}");
                return resolved;
            }
        }

        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            let winget_path = PathBuf::from(&local_app_data)
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join("glab.exe");
            if winget_path.exists() {
                let resolved = winget_path.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in WinGet Links: {resolved}");
                return resolved;
            }

            let scoop_shims = PathBuf::from(&local_app_data)
                .join("scoop")
                .join("shims")
                .join("glab.exe");
            if scoop_shims.exists() {
                let resolved = scoop_shims.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in Scoop shims: {resolved}");
                return resolved;
            }
        }

        if let Ok(userprofile) = env::var("USERPROFILE") {
            let scoop_path = PathBuf::from(&userprofile)
                .join("scoop")
                .join("shims")
                .join("glab.exe");
            if scoop_path.exists() {
                let resolved = scoop_path.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in user Scoop shims: {resolved}");
                return resolved;
            }
        }
    }

    if let Ok(path) = which::which(command) {
        let path_str = path.to_string_lossy().to_string();
        log::info!("[GitlabCli] Found glab via which crate: {path_str}");

        #[cfg(windows)]
        {
            let resolved = crate::shared::resolve_windows_executable(&path_str);
            log::info!("[GitlabCli] Windows executable resolution: {path_str} -> {resolved}");
            return resolved;
        }

        #[cfg(not(windows))]
        return path_str;
    }

    warn!("[GitlabCli] Falling back to plain 'glab' - binary may not be found");
    command.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::github_cli::CommandOutput;
    use std::collections::VecDeque;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone)]
    struct CommandLog {
        args: Vec<String>,
    }

    #[derive(Default, Clone)]
    struct MockRunner {
        responses: Arc<Mutex<VecDeque<io::Result<CommandOutput>>>>,
        calls: Arc<Mutex<Vec<CommandLog>>>,
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
            _program: &str,
            args: &[&str],
            _current_dir: Option<&Path>,
            _env: &[(&str, &str)],
        ) -> io::Result<CommandOutput> {
            self.calls.lock().unwrap().push(CommandLog {
                args: args.iter().map(|s| s.to_string()).collect(),
            });
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| {
                    Err(io::Error::new(
                        io::ErrorKind::Other,
                        "no mock response queued",
                    ))
                })
        }
    }

    #[test]
    fn ensure_installed_succeeds_when_glab_found() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "glab version 1.46.0 (2024-10-01)".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        assert!(cli.ensure_installed().is_ok());
    }

    #[test]
    fn ensure_installed_fails_when_not_found() {
        let runner = MockRunner::default();
        runner.push_response(Err(io::Error::new(
            io::ErrorKind::NotFound,
            "glab missing",
        )));
        let cli = GitlabCli::with_runner(runner);

        let err = cli.ensure_installed().unwrap_err();
        assert!(matches!(err, GitlabCliError::NotInstalled));
    }

    #[test]
    fn ensure_installed_fails_on_nonzero_exit() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "unknown command".to_string(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let err = cli.ensure_installed().unwrap_err();
        assert!(matches!(err, GitlabCliError::NotInstalled));
    }

    #[test]
    fn ensure_installed_returns_io_error_for_non_notfound() {
        let runner = MockRunner::default();
        runner.push_response(Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "permission denied",
        )));
        let cli = GitlabCli::with_runner(runner);

        let err = cli.ensure_installed().unwrap_err();
        assert!(matches!(err, GitlabCliError::Io(_)));
    }

    #[test]
    fn format_cli_error_not_installed() {
        let msg = format_cli_error(GitlabCliError::NotInstalled);
        assert!(msg.contains("glab"));
        assert!(msg.contains("not installed"));
    }

    #[test]
    fn format_cli_error_command_failed_prefers_stderr() {
        let msg = format_cli_error(GitlabCliError::CommandFailed {
            program: "glab".to_string(),
            args: vec!["mr".to_string(), "list".to_string()],
            status: Some(1),
            stdout: "ignored stdout".to_string(),
            stderr: "something went wrong".to_string(),
        });
        assert!(msg.contains("something went wrong"));
        assert!(msg.contains("glab"));
    }

    #[test]
    fn format_cli_error_command_failed_falls_back_to_stdout() {
        let msg = format_cli_error(GitlabCliError::CommandFailed {
            program: "glab".to_string(),
            args: vec!["issue".to_string()],
            status: Some(1),
            stdout: "stdout fallback".to_string(),
            stderr: "   ".to_string(),
        });
        assert!(msg.contains("stdout fallback"));
    }

    #[test]
    fn format_cli_error_no_git_remote() {
        let msg = format_cli_error(GitlabCliError::NoGitRemote);
        assert!(msg.contains("No Git remotes"));
    }

    #[test]
    fn format_cli_error_io() {
        let msg = format_cli_error(GitlabCliError::Io(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "broken pipe",
        )));
        assert!(msg.contains("broken pipe"));
    }

    #[test]
    fn format_cli_error_json() {
        let json_err = serde_json::from_str::<String>("not json").unwrap_err();
        let msg = format_cli_error(GitlabCliError::Json(json_err));
        assert!(msg.contains("parse GitLab CLI response"));
    }

    #[test]
    fn format_cli_error_git() {
        let msg = format_cli_error(GitlabCliError::Git(anyhow::anyhow!("repo corrupt")));
        assert!(msg.contains("Git operation failed"));
    }

    #[test]
    fn format_cli_error_invalid_input() {
        let msg = format_cli_error(GitlabCliError::InvalidInput("bad query".to_string()));
        assert_eq!(msg, "bad query");
    }

    #[test]
    fn format_cli_error_invalid_output() {
        let msg = format_cli_error(GitlabCliError::InvalidOutput("garbled".to_string()));
        assert_eq!(msg, "garbled");
    }

    #[test]
    fn display_impl_covers_all_variants() {
        let variants: Vec<GitlabCliError> = vec![
            GitlabCliError::NotInstalled,
            GitlabCliError::NoGitRemote,
            GitlabCliError::CommandFailed {
                program: "glab".into(),
                args: vec![],
                status: Some(1),
                stdout: String::new(),
                stderr: "fail".into(),
            },
            GitlabCliError::Io(io::Error::new(io::ErrorKind::Other, "io")),
            GitlabCliError::Json(serde_json::from_str::<String>("x").unwrap_err()),
            GitlabCliError::Git(anyhow::anyhow!("git")),
            GitlabCliError::InvalidInput("input".into()),
            GitlabCliError::InvalidOutput("output".into()),
        ];
        for v in variants {
            let display = format!("{v}");
            assert!(!display.is_empty());
        }
    }

    #[test]
    fn map_runner_error_maps_not_found_to_not_installed() {
        let err = map_runner_error(io::Error::new(io::ErrorKind::NotFound, "not found"));
        assert!(matches!(err, GitlabCliError::NotInstalled));
    }

    #[test]
    fn map_runner_error_maps_other_to_io() {
        let err = map_runner_error(io::Error::new(io::ErrorKind::BrokenPipe, "broken"));
        assert!(matches!(err, GitlabCliError::Io(_)));
    }

    #[test]
    fn command_failure_builds_error_from_output() {
        let output = CommandOutput {
            status: Some(2),
            stdout: "out".to_string(),
            stderr: "err".to_string(),
        };
        let err = command_failure("glab", &["mr".to_string(), "list".to_string()], output);
        match err {
            GitlabCliError::CommandFailed {
                program,
                args,
                status,
                stdout,
                stderr,
            } => {
                assert_eq!(program, "glab");
                assert_eq!(args, vec!["mr", "list"]);
                assert_eq!(status, Some(2));
                assert_eq!(stdout, "out");
                assert_eq!(stderr, "err");
            }
            _ => panic!("expected CommandFailed variant"),
        }
    }

    #[test]
    fn strip_ansi_codes_removes_escape_sequences() {
        assert_eq!(strip_ansi_codes("\x1b[31mred\x1b[0m"), "red");
        assert_eq!(strip_ansi_codes("plain text"), "plain text");
        assert_eq!(strip_ansi_codes(""), "");
        assert_eq!(
            strip_ansi_codes("\x1b[1;32mbold green\x1b[0m normal"),
            "bold green normal"
        );
    }

    #[test]
    fn serde_json_error_converts_to_gitlab_cli_error() {
        let json_err = serde_json::from_str::<String>("invalid").unwrap_err();
        let cli_err: GitlabCliError = json_err.into();
        assert!(matches!(cli_err, GitlabCliError::Json(_)));
    }

    #[test]
    fn with_runner_uses_glab_program_name() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "glab version 1.46.0".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);
        assert_eq!(cli.program, "glab");
    }

    #[test]
    fn check_auth_returns_authenticated_when_logged_in() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "gitlab.com\n  ✓ Logged in to gitlab.com as testuser (keyring)\n  ✓ Git operations for gitlab.com configured to use https protocol.\n".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli.check_auth(None).unwrap();
        assert!(result.authenticated);
        assert_eq!(result.hostname.as_deref(), Some("gitlab.com"));
        assert_eq!(result.user_login.as_deref(), Some("testuser"));
    }

    #[test]
    fn check_auth_returns_unauthenticated_when_not_logged_in() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "No token provided".to_string(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli.check_auth(None).unwrap();
        assert!(!result.authenticated);
        assert!(result.hostname.is_none());
        assert!(result.user_login.is_none());
    }

    #[test]
    fn search_issues_parses_json_response() {
        let runner = MockRunner::default();
        let json = r#"[
            {
                "iid": 42,
                "title": "Fix login bug",
                "state": "opened",
                "updated_at": "2024-01-15T10:30:00Z",
                "author": {"username": "alice", "name": "Alice"},
                "labels": ["bug", "high-priority"],
                "web_url": "https://gitlab.com/group/project/-/issues/42"
            },
            {
                "iid": 43,
                "title": "Add dark mode",
                "state": "closed",
                "updated_at": "2024-01-14T08:00:00Z",
                "author": {"username": "bob", "name": null},
                "labels": [],
                "web_url": "https://gitlab.com/group/project/-/issues/43"
            }
        ]"#;
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json.to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let issues = cli
            .search_issues(
                Path::new("/tmp/repo"),
                "bug",
                10,
                "group/project",
                None,
            )
            .unwrap();

        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].iid, 42);
        assert_eq!(issues[0].title, "Fix login bug");
        assert_eq!(issues[0].state, "opened");
        assert_eq!(
            issues[0].author.as_ref().unwrap().username,
            "alice"
        );
        assert_eq!(issues[0].labels, vec!["bug", "high-priority"]);
        assert_eq!(issues[1].iid, 43);
        assert_eq!(issues[1].labels.len(), 0);
    }

    #[test]
    fn search_issues_returns_empty_for_null_response() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "null".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let issues = cli
            .search_issues(
                Path::new("/tmp/repo"),
                "",
                10,
                "group/project",
                None,
            )
            .unwrap();

        assert!(issues.is_empty());
    }

    #[test]
    fn get_issue_details_parses_json_with_notes() {
        let runner = MockRunner::default();
        let json = r#"{
            "iid": 42,
            "title": "Fix login bug",
            "web_url": "https://gitlab.com/group/project/-/issues/42",
            "description": "Login fails on Safari",
            "labels": ["bug"],
            "state": "opened",
            "author": {"username": "alice", "name": "Alice"},
            "notes": [
                {
                    "author": {"username": "bob", "name": "Bob"},
                    "created_at": "2024-01-15T11:00:00Z",
                    "body": "I can reproduce this",
                    "system": false
                },
                {
                    "author": {"username": "alice", "name": "Alice"},
                    "created_at": "2024-01-15T12:00:00Z",
                    "body": "assigned to @charlie",
                    "system": true
                }
            ]
        }"#;
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json.to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let details = cli
            .get_issue_details(Path::new("/tmp/repo"), 42, "group/project", None)
            .unwrap();

        assert_eq!(details.iid, 42);
        assert_eq!(details.title, "Fix login bug");
        assert_eq!(
            details.description.as_deref(),
            Some("Login fails on Safari")
        );
        assert_eq!(details.notes.len(), 2);
        assert_eq!(
            details.notes[0].author.as_ref().unwrap().username,
            "bob"
        );
        assert_eq!(details.notes[0].body, "I can reproduce this");
        assert!(!details.notes[0].system);
        assert!(details.notes[1].system);
    }

    #[test]
    fn search_mrs_parses_json_response() {
        let runner = MockRunner::default();
        let json = r#"[
            {
                "iid": 101,
                "title": "Add feature X",
                "state": "merged",
                "updated_at": "2024-02-01T09:00:00Z",
                "author": {"username": "carol", "name": "Carol"},
                "labels": ["feature"],
                "web_url": "https://gitlab.com/group/project/-/merge_requests/101",
                "source_branch": "feature-x",
                "target_branch": "main"
            }
        ]"#;
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json.to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let mrs = cli
            .search_mrs(
                Path::new("/tmp/repo"),
                "feature",
                10,
                "group/project",
                None,
            )
            .unwrap();

        assert_eq!(mrs.len(), 1);
        assert_eq!(mrs[0].iid, 101);
        assert_eq!(mrs[0].title, "Add feature X");
        assert_eq!(mrs[0].state, "merged");
        assert_eq!(mrs[0].source_branch, "feature-x");
        assert_eq!(mrs[0].target_branch, "main");
        assert_eq!(
            mrs[0].author.as_ref().unwrap().username,
            "carol"
        );
    }

    #[test]
    fn get_mr_details_parses_pipeline_and_reviewers() {
        let runner = MockRunner::default();
        let json = r#"{
            "iid": 101,
            "title": "Add feature X",
            "web_url": "https://gitlab.com/group/project/-/merge_requests/101",
            "description": "Implements feature X with tests",
            "labels": ["feature", "reviewed"],
            "state": "opened",
            "source_branch": "feature-x",
            "target_branch": "main",
            "author": {"username": "carol", "name": "Carol"},
            "merge_status": "can_be_merged",
            "pipeline": {
                "id": 999,
                "status": "success",
                "web_url": "https://gitlab.com/group/project/-/pipelines/999"
            },
            "notes": [
                {
                    "author": {"username": "dave", "name": "Dave"},
                    "created_at": "2024-02-02T10:00:00Z",
                    "body": "LGTM",
                    "system": false
                }
            ],
            "reviewers": [
                {"username": "dave", "name": "Dave"},
                {"username": "eve", "name": "Eve"}
            ]
        }"#;
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json.to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let details = cli
            .get_mr_details(Path::new("/tmp/repo"), 101, "group/project", None)
            .unwrap();

        assert_eq!(details.iid, 101);
        assert_eq!(
            details.description.as_deref(),
            Some("Implements feature X with tests")
        );
        assert_eq!(
            details.merge_status.as_deref(),
            Some("can_be_merged")
        );

        let pipeline = details.pipeline.as_ref().unwrap();
        assert_eq!(pipeline.id, 999);
        assert_eq!(pipeline.status, "success");
        assert_eq!(
            pipeline.web_url.as_deref(),
            Some("https://gitlab.com/group/project/-/pipelines/999")
        );

        assert_eq!(details.reviewers.len(), 2);
        assert_eq!(details.reviewers[0].username, "dave");
        assert_eq!(details.reviewers[1].username, "eve");

        assert_eq!(details.notes.len(), 1);
        assert_eq!(details.notes[0].body, "LGTM");
    }

    #[test]
    fn get_mr_pipeline_status_returns_pipeline_details() {
        let runner = MockRunner::default();
        let json = r#"{
            "id": 555,
            "status": "running",
            "web_url": "https://gitlab.com/group/project/-/pipelines/555",
            "source": "push",
            "duration": 120.5,
            "created_at": "2024-03-01T08:00:00Z",
            "updated_at": "2024-03-01T08:02:00Z"
        }"#;
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: json.to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli
            .get_mr_pipeline_status(
                Path::new("/tmp/repo"),
                "feature-branch",
                "group/project",
                None,
            )
            .unwrap();

        let pipeline = result.unwrap();
        assert_eq!(pipeline.id, 555);
        assert_eq!(pipeline.status, "running");
        assert_eq!(
            pipeline.web_url.as_deref(),
            Some("https://gitlab.com/group/project/-/pipelines/555")
        );
        assert_eq!(pipeline.source.as_deref(), Some("push"));
        assert_eq!(pipeline.duration, Some(120.5));
        assert_eq!(
            pipeline.created_at.as_deref(),
            Some("2024-03-01T08:00:00Z")
        );
    }

    #[test]
    fn get_mr_pipeline_status_returns_none_on_failure() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "no pipeline found".to_string(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli
            .get_mr_pipeline_status(
                Path::new("/tmp/repo"),
                "no-pipeline-branch",
                "group/project",
                None,
            )
            .unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn extract_mr_url_finds_url_in_output() {
        let output = "Creating merge request...\nhttps://gitlab.com/group/project/-/merge_requests/123\n!123 opened\n";
        assert_eq!(
            extract_mr_url(output),
            Some("https://gitlab.com/group/project/-/merge_requests/123".to_string())
        );
    }

    #[test]
    fn extract_mr_url_returns_none_when_missing() {
        let output = "Creating merge request...\nDone!\n";
        assert_eq!(extract_mr_url(output), None);
    }

    #[test]
    fn extract_mr_url_handles_self_hosted() {
        let output = "  https://gitlab.mycompany.com/team/repo/-/merge_requests/42  \n";
        assert_eq!(
            extract_mr_url(output),
            Some("https://gitlab.mycompany.com/team/repo/-/merge_requests/42".to_string())
        );
    }

    #[test]
    fn create_mr_extracts_url_from_output() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "Creating merge request for feature-branch into main in group/project\nhttps://gitlab.com/group/project/-/merge_requests/99\n".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli
            .create_mr(CreateMrParams {
                project_path: Path::new("/tmp/repo"),
                gitlab_project: "group/project",
                title: "My MR Title",
                description: Some("Description here"),
                source_branch: "feature-branch",
                target_branch: "main",
                hostname: None,
            })
            .unwrap();

        assert_eq!(result.source_branch, "feature-branch");
        assert_eq!(
            result.url,
            "https://gitlab.com/group/project/-/merge_requests/99"
        );
    }

    #[test]
    fn create_mr_fails_when_no_url_in_output() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "Created successfully".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli.create_mr(CreateMrParams {
            project_path: Path::new("/tmp/repo"),
            gitlab_project: "group/project",
            title: "Title",
            description: None,
            source_branch: "branch",
            target_branch: "main",
            hostname: None,
        });

        assert!(matches!(result, Err(GitlabCliError::InvalidOutput(_))));
    }

    #[test]
    fn approve_mr_succeeds_on_exit_zero() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "Approved".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli.approve_mr(
            Path::new("/tmp/repo"),
            42,
            "group/project",
            None,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn approve_mr_fails_on_nonzero_exit() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "permission denied".to_string(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli.approve_mr(
            Path::new("/tmp/repo"),
            42,
            "group/project",
            None,
        );

        assert!(matches!(result, Err(GitlabCliError::CommandFailed { .. })));
    }

    #[test]
    fn merge_mr_passes_squash_flag() {
        let runner = MockRunner::default();
        let runner_clone = runner.clone();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "Merged".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner_clone);

        let result = cli.merge_mr(
            Path::new("/tmp/repo"),
            55,
            "group/project",
            true,
            true,
            None,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn merge_mr_fails_on_nonzero_exit() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "merge conflict".to_string(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli.merge_mr(
            Path::new("/tmp/repo"),
            55,
            "group/project",
            false,
            false,
            None,
        );

        assert!(matches!(result, Err(GitlabCliError::CommandFailed { .. })));
    }

    #[test]
    fn comment_on_mr_succeeds() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "Note added".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli.comment_on_mr(
            Path::new("/tmp/repo"),
            10,
            "group/project",
            "LGTM!",
            None,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn comment_on_mr_fails_on_nonzero_exit() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "not found".to_string(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let result = cli.comment_on_mr(
            Path::new("/tmp/repo"),
            10,
            "group/project",
            "Hello",
            None,
        );

        assert!(matches!(result, Err(GitlabCliError::CommandFailed { .. })));
    }

    fn ok_output(stdout: &str) -> io::Result<CommandOutput> {
        Ok(CommandOutput {
            status: Some(0),
            stdout: stdout.to_string(),
            stderr: String::new(),
        })
    }

    fn fail_output(stderr: &str) -> io::Result<CommandOutput> {
        Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: stderr.to_string(),
        })
    }

    fn create_temp_git_repo() -> tempfile::TempDir {
        use git2::{Repository, Signature};
        let temp_dir = tempfile::TempDir::new().unwrap();
        let repo = Repository::init(temp_dir.path()).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .unwrap();
        temp_dir
    }

    #[test]
    fn create_session_mr_reapply_mode() {
        let temp_dir = create_temp_git_repo();
        let runner = MockRunner::default();
        // 1. ensure_git_remote: git remote
        runner.push_response(ok_output("origin\n"));
        // 2. push HEAD to remote
        runner.push_response(ok_output(""));
        // 3. set upstream tracking
        runner.push_response(ok_output(""));
        // 4. glab mr create
        runner.push_response(ok_output(
            "Creating merge request...\nhttps://gitlab.com/group/project/-/merge_requests/42\n",
        ));

        let cli = GitlabCli::with_runner(runner);
        let result = cli
            .create_session_mr(CreateSessionMrOptions {
                repo_path: temp_dir.path(),
                session_worktree_path: temp_dir.path(),
                session_slug: "test-session",
                session_branch: "schaltwerk/test-session",
                base_branch: "main",
                mr_branch_name: "schaltwerk/test-session",
                title: "Test MR",
                description: None,
                gitlab_project: "group/project",
                hostname: None,
                squash: false,
                mode: MrCommitMode::Reapply,
                commit_message: None,
            })
            .unwrap();

        assert_eq!(
            result.url,
            "https://gitlab.com/group/project/-/merge_requests/42"
        );
        assert_eq!(result.source_branch, "schaltwerk/test-session");
    }

    #[test]
    fn create_session_mr_squash_mode() {
        let runner = MockRunner::default();
        // 1. ensure_git_remote: git remote
        runner.push_response(ok_output("origin\n"));
        // 2. resolve merge-base (origin/main)
        runner.push_response(ok_output("abc123\n"));
        // 3. git reset --soft
        runner.push_response(ok_output(""));
        // 4. git add -A
        runner.push_response(ok_output(""));
        // 5. git commit
        runner.push_response(ok_output(""));
        // 6. push HEAD to remote
        runner.push_response(ok_output(""));
        // 7. set upstream tracking
        runner.push_response(ok_output(""));
        // 8. glab mr create
        runner.push_response(ok_output(
            "https://gitlab.com/group/project/-/merge_requests/55\n",
        ));

        let cli = GitlabCli::with_runner(runner);
        let result = cli
            .create_session_mr(CreateSessionMrOptions {
                repo_path: Path::new("/tmp/repo"),
                session_worktree_path: Path::new("/tmp/worktree"),
                session_slug: "test-session",
                session_branch: "schaltwerk/test-session",
                base_branch: "main",
                mr_branch_name: "schaltwerk/test-session",
                title: "Test MR",
                description: None,
                gitlab_project: "group/project",
                hostname: None,
                squash: false,
                mode: MrCommitMode::Squash,
                commit_message: Some("squash commit"),
            })
            .unwrap();

        assert_eq!(
            result.url,
            "https://gitlab.com/group/project/-/merge_requests/55"
        );
    }

    #[test]
    fn create_session_mr_squash_flag_adds_squash_message() {
        let runner = MockRunner::default();
        runner.push_response(ok_output("origin\n"));
        runner.push_response(ok_output("abc123\n"));
        runner.push_response(ok_output(""));
        runner.push_response(ok_output(""));
        runner.push_response(ok_output(""));
        runner.push_response(ok_output(""));
        runner.push_response(ok_output(""));
        runner.push_response(ok_output(
            "https://gitlab.com/group/project/-/merge_requests/60\n",
        ));

        let cli = GitlabCli::with_runner(runner.clone());
        let result = cli
            .create_session_mr(CreateSessionMrOptions {
                repo_path: Path::new("/tmp/repo"),
                session_worktree_path: Path::new("/tmp/worktree"),
                session_slug: "test-session",
                session_branch: "schaltwerk/test-session",
                base_branch: "main",
                mr_branch_name: "schaltwerk/test-session",
                title: "Test MR",
                description: None,
                gitlab_project: "group/project",
                hostname: None,
                squash: true,
                mode: MrCommitMode::Squash,
                commit_message: Some("my squash commit"),
            })
            .unwrap();

        assert_eq!(
            result.url,
            "https://gitlab.com/group/project/-/merge_requests/60"
        );

        let calls = runner.calls();
        let glab_call = calls.last().unwrap();
        let args_str = glab_call.args.join(" ");
        assert!(
            args_str.contains("--squash-message-body"),
            "Expected --squash-message-body in glab args: {args_str}"
        );
        assert!(
            args_str.contains("my squash commit"),
            "Expected squash commit message in glab args: {args_str}"
        );
    }

    #[test]
    fn create_session_mr_with_description() {
        let temp_dir = create_temp_git_repo();
        let runner = MockRunner::default();
        // 1. ensure_git_remote
        runner.push_response(ok_output("origin\n"));
        // 2. push HEAD
        runner.push_response(ok_output(""));
        // 3. set upstream
        runner.push_response(ok_output(""));
        // 4. glab mr create
        runner.push_response(ok_output(
            "https://gitlab.com/group/project/-/merge_requests/77\n",
        ));

        let cli = GitlabCli::with_runner(runner);
        let result = cli
            .create_session_mr(CreateSessionMrOptions {
                repo_path: temp_dir.path(),
                session_worktree_path: temp_dir.path(),
                session_slug: "test-session",
                session_branch: "schaltwerk/test-session",
                base_branch: "main",
                mr_branch_name: "schaltwerk/test-session",
                title: "Test MR",
                description: Some("MR description body"),
                gitlab_project: "group/project",
                hostname: None,
                squash: false,
                mode: MrCommitMode::Reapply,
                commit_message: None,
            })
            .unwrap();

        assert_eq!(
            result.url,
            "https://gitlab.com/group/project/-/merge_requests/77"
        );
    }

    #[test]
    fn create_session_mr_with_hostname() {
        let temp_dir = create_temp_git_repo();
        let runner = MockRunner::default();
        // 1. ensure_git_remote
        runner.push_response(ok_output("origin\n"));
        // 2. push HEAD
        runner.push_response(ok_output(""));
        // 3. set upstream
        runner.push_response(ok_output(""));
        // 4. glab mr create
        runner.push_response(ok_output(
            "https://gitlab.mycompany.com/team/repo/-/merge_requests/10\n",
        ));

        let cli = GitlabCli::with_runner(runner);
        let result = cli
            .create_session_mr(CreateSessionMrOptions {
                repo_path: temp_dir.path(),
                session_worktree_path: temp_dir.path(),
                session_slug: "test-session",
                session_branch: "schaltwerk/test-session",
                base_branch: "main",
                mr_branch_name: "schaltwerk/test-session",
                title: "Test MR",
                description: None,
                gitlab_project: "group/project",
                hostname: Some("gitlab.mycompany.com"),
                squash: false,
                mode: MrCommitMode::Reapply,
                commit_message: None,
            })
            .unwrap();

        assert_eq!(
            result.url,
            "https://gitlab.mycompany.com/team/repo/-/merge_requests/10"
        );
    }

    #[test]
    fn create_session_mr_push_fails_non_fast_forward() {
        let temp_dir = create_temp_git_repo();
        let runner = MockRunner::default();
        // 1. ensure_git_remote
        runner.push_response(ok_output("origin\n"));
        // 2. push HEAD fails with non-fast-forward
        runner.push_response(fail_output(
            "error: failed to push some refs: non-fast-forward",
        ));

        let cli = GitlabCli::with_runner(runner);
        let result = cli.create_session_mr(CreateSessionMrOptions {
            repo_path: temp_dir.path(),
            session_worktree_path: temp_dir.path(),
            session_slug: "test-session",
            session_branch: "schaltwerk/test-session",
            base_branch: "main",
            mr_branch_name: "schaltwerk/test-session",
            title: "Test MR",
            description: None,
            gitlab_project: "group/project",
            hostname: None,
            squash: false,
            mode: MrCommitMode::Reapply,
            commit_message: None,
        });

        match result {
            Err(GitlabCliError::InvalidInput(msg)) => {
                assert!(msg.contains("[rejected]"), "Expected [rejected] in: {msg}");
            }
            other => panic!("Expected InvalidInput, got: {other:?}"),
        }
    }

    #[test]
    fn create_session_mr_no_remote_fails() {
        let runner = MockRunner::default();
        runner.push_response(ok_output(""));

        let cli = GitlabCli::with_runner(runner);
        let result = cli.create_session_mr(CreateSessionMrOptions {
            repo_path: Path::new("/tmp/repo"),
            session_worktree_path: Path::new("/tmp/worktree"),
            session_slug: "test-session",
            session_branch: "schaltwerk/test-session",
            base_branch: "main",
            mr_branch_name: "schaltwerk/test-session",
            title: "Test MR",
            description: None,
            gitlab_project: "group/project",
            hostname: None,
            squash: false,
            mode: MrCommitMode::Reapply,
            commit_message: None,
        });

        assert!(matches!(result, Err(GitlabCliError::NoGitRemote)));
    }

    #[test]
    fn resolve_merge_base_tries_origin_first() {
        let runner = MockRunner::default();
        runner.push_response(ok_output("deadbeef\n"));

        let result = resolve_merge_base(&runner, Path::new("/tmp/wt"), "main").unwrap();
        assert_eq!(result, "deadbeef");
    }

    #[test]
    fn resolve_merge_base_falls_back_to_local() {
        let runner = MockRunner::default();
        // origin/main fails
        runner.push_response(fail_output("not found"));
        // local main succeeds
        runner.push_response(ok_output("cafebabe\n"));

        let result = resolve_merge_base(&runner, Path::new("/tmp/wt"), "main").unwrap();
        assert_eq!(result, "cafebabe");
    }

    #[test]
    fn resolve_merge_base_fails_when_both_fail() {
        let runner = MockRunner::default();
        runner.push_response(fail_output("not found"));
        runner.push_response(fail_output("not found either"));

        let result = resolve_merge_base(&runner, Path::new("/tmp/wt"), "main");
        assert!(result.is_err());
    }

    #[test]
    fn ensure_git_remote_fails_on_empty() {
        let runner = MockRunner::default();
        runner.push_response(ok_output(""));

        let result = ensure_git_remote(&runner, Path::new("/tmp/repo"));
        assert!(matches!(result, Err(GitlabCliError::NoGitRemote)));
    }

    #[test]
    fn ensure_git_remote_succeeds_with_remote() {
        let runner = MockRunner::default();
        runner.push_response(ok_output("origin\n"));

        let result = ensure_git_remote(&runner, Path::new("/tmp/repo"));
        assert!(result.is_ok());
    }
}

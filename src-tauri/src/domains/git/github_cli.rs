use std::env;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;

use anyhow::Error as AnyhowError;
use git2::Repository;
use log::{debug, info};
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
                    info!("GitHub CLI detected: {}", output.stdout.trim());
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
                    info!("GitHub authentication verified for {login:?}");
                    return Ok(GitHubAuthStatus {
                        authenticated: true,
                        user_login: login,
                    });
                }
                Ok(_) => {
                    info!("GitHub authentication verified but failed to get user info");
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

fn resolve_github_cli_program() -> String {
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
            log::warn!("[GitHubCli] 'which gh' failed: {err}");
        }
    }

    log::warn!("[GitHubCli] Falling back to plain 'gh' - binary may not be found");
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

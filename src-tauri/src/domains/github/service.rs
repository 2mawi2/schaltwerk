use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use super::{build_compare_url, parse_github_remote, GitHubRemote};
use anyhow::{anyhow, Context};
use git2::BranchType;

use crate::domains::git;
use tempfile::Builder;

pub struct GitHubPublishService {
    repo_path: PathBuf,
    pusher: Arc<dyn GitPusher>,
}

impl GitHubPublishService {
    pub fn new(repo_path: PathBuf) -> Self {
        Self::with_pusher(repo_path, Arc::new(SystemGitPusher))
    }

    pub fn with_pusher(repo_path: PathBuf, pusher: Arc<dyn GitPusher>) -> Self {
        Self { repo_path, pusher }
    }

    pub fn list_github_remotes(&self) -> anyhow::Result<Vec<GitHubRemote>> {
        let repo = git2::Repository::discover(&self.repo_path).with_context(|| {
            format!(
                "Failed to open git repository at {}",
                self.repo_path.display()
            )
        })?;

        let mut results = Vec::new();

        if let Ok(remotes) = repo.remotes() {
            for name_opt in remotes.iter() {
                let name = match name_opt {
                    Some(name) => name,
                    None => continue,
                };

                let remote = match repo.find_remote(name) {
                    Ok(remote) => remote,
                    Err(_) => continue,
                };

                let url_candidates = remote.url().into_iter().chain(remote.pushurl().into_iter());

                for url in url_candidates {
                    if let Some(info) = parse_github_remote(name, url) {
                        results.push(info);
                        break;
                    }
                }
            }
        }

        Ok(results)
    }

    pub fn prepare_publish(&self, request: PublishRequest) -> anyhow::Result<PublishResult> {
        match request.mode {
            PublishMode::KeepCommits => self.prepare_keep_commits(request),
            PublishMode::Squash => self.prepare_squash(request),
        }
    }

    fn prepare_keep_commits(&self, request: PublishRequest) -> anyhow::Result<PublishResult> {
        if git::has_uncommitted_changes(&request.session_worktree_path)? {
            return Err(anyhow!(
                "Session worktree has uncommitted changes. Please commit or discard them before publishing."
            ));
        }

        let repo = git2::Repository::discover(&self.repo_path).with_context(|| {
            format!(
                "Failed to open git repository at {}",
                self.repo_path.display()
            )
        })?;

        let branch = repo
            .find_branch(&request.session_branch, BranchType::Local)
            .with_context(|| format!("Session branch '{}' not found", request.session_branch))?;

        let target_oid = branch.get().target().ok_or_else(|| {
            anyhow!(
                "Session branch '{}' has no target commit",
                request.session_branch
            )
        })?;

        let target_commit = repo
            .find_commit(target_oid)
            .with_context(|| format!("Failed to load commit for '{}'", request.session_branch))?;

        if let Ok(mut existing) = repo.find_branch(&request.target_branch, BranchType::Local) {
            existing.delete().with_context(|| {
                format!(
                    "Failed to delete existing branch '{}'",
                    request.target_branch
                )
            })?;
        }

        repo.branch(&request.target_branch, &target_commit, true)
            .with_context(|| {
                format!("Failed to create local branch '{}'", request.target_branch)
            })?;

        self.pusher
            .push(
                &self.repo_path,
                &request.remote.remote_name,
                &request.target_branch,
            )
            .with_context(|| format!("Failed to push branch '{}'", request.target_branch))?;

        let compare_url = build_compare_url(
            &request.remote,
            &request.base_branch,
            &request.target_branch,
        );

        Ok(PublishResult {
            compare_url,
            pushed_branch: request.target_branch,
            mode: request.mode,
        })
    }

    fn prepare_squash(&self, request: PublishRequest) -> anyhow::Result<PublishResult> {
        if git::has_uncommitted_changes(&request.session_worktree_path)? {
            return Err(anyhow!(
                "Session worktree has uncommitted changes. Please commit or discard them before publishing."
            ));
        }

        let repo = git2::Repository::discover(&self.repo_path).with_context(|| {
            format!(
                "Failed to open git repository at {}",
                self.repo_path.display()
            )
        })?;

        // Ensure session branch exists before proceeding
        repo.find_branch(&request.session_branch, BranchType::Local)
            .with_context(|| format!("Session branch '{}' not found", request.session_branch))?;

        if let Ok(mut existing) = repo.find_branch(&request.target_branch, BranchType::Local) {
            existing.delete().with_context(|| {
                format!(
                    "Failed to delete existing branch '{}'",
                    request.target_branch
                )
            })?;
        }

        let temp_dir = Builder::new()
            .prefix("schaltwerk-github-publish-")
            .tempdir()
            .context("Failed to create temporary worktree directory")?;
        let temp_path = temp_dir.path();
        let temp_path_str = temp_path
            .to_str()
            .ok_or_else(|| anyhow!("Temporary path contains invalid UTF-8"))?;

        self.git(&[
            "worktree",
            "add",
            "--detach",
            temp_path_str,
            &request.base_branch,
        ])
        .with_context(|| "Failed to create temporary worktree from base branch")?;

        self.git_in(temp_path, &["checkout", "-b", &request.target_branch])
            .with_context(|| {
                format!(
                    "Failed to create branch '{}' in temporary worktree",
                    request.target_branch
                )
            })?;

        self.git_in(temp_path, &["merge", "--squash", &request.session_branch])
            .with_context(|| "Failed to perform squash merge")?;

        let status = self.git_output(temp_path, &["status", "--porcelain"])?;
        if status.trim().is_empty() {
            self.git(&["worktree", "remove", "--force", temp_path_str])?;
            return Err(anyhow!(
                "Squash merge produced no changes. Nothing to publish."
            ));
        }

        self.git_in(temp_path, &["commit", "-m", &request.commit_message])
            .with_context(|| "Failed to create squash commit")?;

        self.git(&["worktree", "remove", "--force", temp_path_str])
            .with_context(|| "Failed to remove temporary worktree")?;

        // Ensure temporary directory is cleaned up even if git removed it already
        let _ = temp_dir.close();

        self.pusher
            .push(
                &self.repo_path,
                &request.remote.remote_name,
                &request.target_branch,
            )
            .with_context(|| format!("Failed to push branch '{}'", request.target_branch))?;

        let compare_url = build_compare_url(
            &request.remote,
            &request.base_branch,
            &request.target_branch,
        );

        Ok(PublishResult {
            compare_url,
            pushed_branch: request.target_branch,
            mode: request.mode,
        })
    }

    fn git(&self, args: &[&str]) -> anyhow::Result<()> {
        self.git_in(&self.repo_path, args)
    }

    fn git_in(&self, dir: &Path, args: &[&str]) -> anyhow::Result<()> {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .with_context(|| format!("Failed to execute git {:?} in {}", args, dir.display()))?;
        if status.success() {
            Ok(())
        } else {
            Err(anyhow!(
                "git {:?} returned non-zero exit status in {}",
                args,
                dir.display()
            ))
        }
    }

    fn git_output(&self, dir: &Path, args: &[&str]) -> anyhow::Result<String> {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .with_context(|| format!("Failed to execute git {:?} in {}", args, dir.display()))?;
        if !output.status.success() {
            return Err(anyhow!(
                "git {:?} returned non-zero exit status in {}",
                args,
                dir.display()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

pub trait GitPusher: Send + Sync {
    fn push(&self, repo_path: &Path, remote: &str, branch: &str) -> anyhow::Result<()>;
}

pub struct SystemGitPusher;

impl GitPusher for SystemGitPusher {
    fn push(&self, repo_path: &Path, remote: &str, branch: &str) -> anyhow::Result<()> {
        let status = Command::new("git")
            .args(["push", remote, &format!("{branch}:{branch}")])
            .current_dir(repo_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .with_context(|| format!("Failed to execute git push for {remote}/{branch}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(anyhow!(
                "git push returned non-zero exit status for {}/{}",
                remote,
                branch
            ))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishMode {
    Squash,
    KeepCommits,
}

#[derive(Debug, Clone)]
pub struct PublishRequest {
    pub remote: GitHubRemote,
    pub base_branch: String,
    pub target_branch: String,
    pub session_branch: String,
    pub session_worktree_path: PathBuf,
    pub commit_message: String,
    pub mode: PublishMode,
}

#[derive(Debug, Clone)]
pub struct PublishResult {
    pub compare_url: String,
    pub pushed_branch: String,
    pub mode: PublishMode,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    fn git(args: &[&str], dir: &PathBuf) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("failed to run git command");
        assert!(status.success(), "git {:?} failed", args);
    }

    fn git_output(args: &[&str], dir: &PathBuf) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("failed to run git command");
        assert!(output.status.success(), "git {:?} failed", args);
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[test]
    fn lists_github_remotes_from_repository() {
        let tmp = TempDir::new().unwrap();
        let repo_path: PathBuf = tmp.path().to_path_buf();
        git(&["init"], &repo_path);
        git(
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/acme/widgets.git",
            ],
            &repo_path,
        );
        git(
            &[
                "remote",
                "add",
                "gitlab",
                "https://gitlab.com/acme/widgets.git",
            ],
            &repo_path,
        );

        let service = GitHubPublishService::new(repo_path.clone());
        let remotes = service.list_github_remotes().unwrap();

        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].remote_name, "origin");
        assert_eq!(remotes[0].owner, "acme");
        assert_eq!(remotes[0].repo, "widgets");
    }

    struct RecordingPusher {
        pushes: Arc<Mutex<Vec<(String, String)>>>,
    }

    impl GitPusher for RecordingPusher {
        fn push(&self, _repo_path: &Path, remote: &str, branch: &str) -> anyhow::Result<()> {
            self.pushes
                .lock()
                .unwrap()
                .push((remote.to_string(), branch.to_string()));
            Ok(())
        }
    }

    #[test]
    fn prepare_publish_keep_commits_records_push_and_returns_url() {
        let tmp = TempDir::new().unwrap();
        let repo_path: PathBuf = tmp.path().to_path_buf();
        git(&["init"], &repo_path);
        git(&["config", "user.email", "test@example.com"], &repo_path);
        git(&["config", "user.name", "Test User"], &repo_path);

        std::fs::write(repo_path.join("README.md"), "hello").unwrap();
        git(&["add", "."], &repo_path);
        git(&["commit", "-m", "Initial"], &repo_path);
        git(&["branch", "-M", "main"], &repo_path);

        git(&["checkout", "-b", "session/test"], &repo_path);
        std::fs::write(repo_path.join("feature.txt"), "feature work").unwrap();
        git(&["add", "feature.txt"], &repo_path);
        git(&["commit", "-m", "Session work"], &repo_path);

        git(&["checkout", "main"], &repo_path);

        let session_worktree = repo_path.join("session-wt");
        git(
            &[
                "worktree",
                "add",
                session_worktree.to_str().unwrap(),
                "session/test",
            ],
            &repo_path,
        );

        git(
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/acme/widgets.git",
            ],
            &repo_path,
        );

        let pushes = Arc::new(Mutex::new(Vec::new()));
        let pusher: Arc<dyn GitPusher> = Arc::new(RecordingPusher {
            pushes: pushes.clone(),
        });

        let service = GitHubPublishService::with_pusher(repo_path.clone(), pusher);

        let request = PublishRequest {
            remote: GitHubRemote {
                remote_name: "origin".into(),
                owner: "acme".into(),
                repo: "widgets".into(),
                host: "github.com".into(),
            },
            base_branch: "main".into(),
            target_branch: "feature/pr".into(),
            session_branch: "session/test".into(),
            session_worktree_path: session_worktree,
            commit_message: "Session publish".into(),
            mode: PublishMode::KeepCommits,
        };

        let result = service
            .prepare_publish(request)
            .expect("publish should succeed");

        let pushes = pushes.lock().unwrap().clone();
        assert_eq!(pushes.len(), 1);
        assert_eq!(pushes[0].0, "origin");
        assert_eq!(pushes[0].1, "feature/pr");

        assert_eq!(result.pushed_branch, "feature/pr");
        assert_eq!(result.mode, PublishMode::KeepCommits);
        assert_eq!(
            result.compare_url,
            "https://github.com/acme/widgets/compare/main...feature%2Fpr?expand=1&quick_pull=1"
        );
    }

    #[test]
    fn prepare_publish_squash_creates_single_commit() {
        let tmp = TempDir::new().unwrap();
        let repo_path: PathBuf = tmp.path().to_path_buf();
        git(&["init"], &repo_path);
        git(&["config", "user.email", "test@example.com"], &repo_path);
        git(&["config", "user.name", "Test User"], &repo_path);

        std::fs::write(repo_path.join("README.md"), "hello").unwrap();
        git(&["add", "."], &repo_path);
        git(&["commit", "-m", "Initial"], &repo_path);
        git(&["branch", "-M", "main"], &repo_path);

        git(&["checkout", "-b", "session/test"], &repo_path);
        std::fs::write(repo_path.join("feature.txt"), "line one\n").unwrap();
        git(&["add", "feature.txt"], &repo_path);
        git(&["commit", "-m", "Add feature file"], &repo_path);

        std::fs::write(repo_path.join("feature.txt"), "line one\nline two\n").unwrap();
        git(&["add", "feature.txt"], &repo_path);
        git(&["commit", "-m", "Add second line"], &repo_path);

        git(&["checkout", "main"], &repo_path);

        let session_worktree = repo_path.join("session-wt");
        git(
            &[
                "worktree",
                "add",
                session_worktree.to_str().unwrap(),
                "session/test",
            ],
            &repo_path,
        );

        git(
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/acme/widgets.git",
            ],
            &repo_path,
        );

        let pushes = Arc::new(Mutex::new(Vec::new()));
        let pusher: Arc<dyn GitPusher> = Arc::new(RecordingPusher {
            pushes: pushes.clone(),
        });

        let service = GitHubPublishService::with_pusher(repo_path.clone(), pusher);

        let request = PublishRequest {
            remote: GitHubRemote {
                remote_name: "origin".into(),
                owner: "acme".into(),
                repo: "widgets".into(),
                host: "github.com".into(),
            },
            base_branch: "main".into(),
            target_branch: "feature/pr".into(),
            session_branch: "session/test".into(),
            session_worktree_path: session_worktree,
            commit_message: "Session summary".into(),
            mode: PublishMode::Squash,
        };

        let result = service
            .prepare_publish(request)
            .expect("squash publish should succeed");

        let pushes = pushes.lock().unwrap().clone();
        assert_eq!(pushes.len(), 1);
        assert_eq!(pushes[0].0, "origin");
        assert_eq!(pushes[0].1, "feature/pr");

        assert_eq!(result.pushed_branch, "feature/pr");
        assert_eq!(result.mode, PublishMode::Squash);
        assert_eq!(
            result.compare_url,
            "https://github.com/acme/widgets/compare/main...feature%2Fpr?expand=1&quick_pull=1"
        );

        let head_message = git_output(&["log", "-1", "--pretty=%s", "feature/pr"], &repo_path);
        assert_eq!(head_message, "Session summary");

        let commit_count = git_output(&["rev-list", "--count", "main..feature/pr"], &repo_path);
        assert_eq!(commit_count, "1");

        let file_content = git_output(&["show", "feature/pr:feature.txt"], &repo_path);
        assert_eq!(file_content, "line one\nline two");
    }
}

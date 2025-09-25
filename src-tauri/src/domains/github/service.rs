use std::path::PathBuf;

use super::{parse_github_remote, GitHubRemote};
use anyhow::Context;

pub struct GitHubPublishService {
    repo_path: PathBuf,
}

impl GitHubPublishService {
    pub fn new(repo_path: PathBuf) -> Self {
        Self { repo_path }
    }

    pub fn list_github_remotes(&self) -> anyhow::Result<Vec<GitHubRemote>> {
        let repo = git2::Repository::discover(&self.repo_path)
            .with_context(|| format!("Failed to open git repository at {}", self.repo_path.display()))?;

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

                let url_candidates = remote
                    .url()
                    .into_iter()
                    .chain(remote.pushurl().into_iter());

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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn git(args: &[&str], dir: &PathBuf) {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .expect("failed to run git command");
        assert!(status.success(), "git {:?} failed", args);
    }

    #[test]
    fn lists_github_remotes_from_repository() {
        let tmp = TempDir::new().unwrap();
        let repo_path: PathBuf = tmp.path().to_path_buf();
        git(&["init"], &repo_path);
        git(
            &["remote", "add", "origin", "https://github.com/acme/widgets.git"],
            &repo_path,
        );
        git(
            &["remote", "add", "gitlab", "https://gitlab.com/acme/widgets.git"],
            &repo_path,
        );

        let service = GitHubPublishService::new(repo_path.clone());
        let remotes = service.list_github_remotes().unwrap();

        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].remote_name, "origin");
        assert_eq!(remotes[0].owner, "acme");
        assert_eq!(remotes[0].repo, "widgets");
    }
}
